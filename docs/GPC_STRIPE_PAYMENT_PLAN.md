# GPC Membership — Stripe Payment Integration Plan

## Objective

Replace the current two-step onboarding (apply → approve → user pays) with a single-step flow where card details are captured at application time and charged automatically upon committee approval.

---

## Current Flow

1. User submits membership application
2. Committee reviews and approves
3. User receives approval notification and must return to pay
4. Membership activates after payment

## Target Flow

1. User submits membership application **with card details** (no charge yet)
2. Committee reviews and approves **within 5 days** (reminder emails at day 1, 3, 4)
3. System **automatically charges** the card
4. Membership activates — user receives confirmation

---

## Stripe Architecture: Two Approaches

There are two viable Stripe patterns. **We recommend Approach A (PaymentIntent with manual capture)** as the primary path because it guarantees the funds and gives the cleanest UX. Approach B (SetupIntent) serves as the automatic fallback when the hold expires.

### Approach A: PaymentIntent with Manual Capture (RECOMMENDED)

At application time, create a PaymentIntent with `capture_method: "manual"`. This **authorizes** the full membership fee on the card (the bank holds the funds) but does not charge it. When the committee approves, call `capture` to complete the charge instantly.

**Pros:**
- Funds are guaranteed — the hold means the money is reserved
- Capture is instant, no risk of decline at approval time
- Simpler flow: one Stripe object from start to finish

**Cons:**
- Authorization hold expires after **5 days** (Visa shortened online authorizations from 7 to 5 days in April 2024; other networks default to 7 but we use the shortest as our constraint)
- If committee doesn't approve in time, the hold is released and the PaymentIntent is cancelled
- Requires a fallback path if the hold expires

**The 5-day committee deadline is a Stripe/Visa constraint, not arbitrary.**

### Approach B: SetupIntent → PaymentIntent (AUTOMATIC FALLBACK)

Because we set `setup_future_usage: "off_session"` on the original PaymentIntent (see Step 1 below), the card is automatically saved to the Stripe Customer even if the hold expires. We can then charge it later via a new PaymentIntent with `off_session: true`.

**Pros:**
- No time limit — saved card can be charged weeks or months later
- SCA is handled upfront during the original authorization

**Cons:**
- Funds are NOT guaranteed — the card could be maxed out, expired, or cancelled
- Off-session charges are more likely to be declined or require re-authentication

**This kicks in automatically if the 5-day hold expires without committee action.**

---

## Recommended Hybrid Flow

### Step 1: Application Submission (Frontend + Backend)

**Backend** — when user submits the application form:

```
POST /v1/customers
  - email, name, metadata: { application_id }

POST /v1/payment_intents
  - amount: <membership_fee_in_centimes>  (e.g., 150000 for CHF 1,500.00)
  - currency: "chf"
  - customer: cus_xxx
  - capture_method: "manual"
  - setup_future_usage: "off_session"    ← KEY: also saves the PaymentMethod for fallback
  - payment_method_types: ["card"]
  - metadata: { application_id, membership_tier }
```

> **Why `setup_future_usage: "off_session"`:** This does double duty — it authorizes the hold AND saves the PaymentMethod to the Customer for future off-session use. If the hold expires, we already have the card on file without the user doing anything extra. It also triggers SCA upfront where required (critical for Swiss/EU cards).

**Frontend** — embed Stripe Payment Element or Card Element:

```javascript
const { error } = await stripe.confirmCardPayment(clientSecret, {
  payment_method: {
    card: cardElement,
    billing_details: { name, email }
  }
});
```

- On success: the PaymentIntent moves to `requires_capture`. Save `payment_intent.id` and `payment_method.id` against the application record. Start the 5-day committee review clock.
- On failure: show inline error, user can retry.

### Step 2: Committee Review Period (5-Day Window)

**Committee reminder schedule (automated emails):**

| Trigger | Recipient | Subject |
|---------|-----------|---------|
| Day 0 (application received) | Committee | "New membership application: [Name] — action required within 5 days" |
| Day 1 (24h, no action) | Committee | "Reminder: [Name]'s application pending — 4 days remaining" |
| Day 3 (no action) | Committee | "Reminder: [Name]'s application pending — 2 days remaining" |
| Day 4 (24h before expiry) | Committee | "⚠️ URGENT: [Name]'s application expires tomorrow — payment hold will be released" |

**Implementation:**
- Use a cron job or scheduled task that runs every hour (hourly granularity avoids timezone edge cases)
- Query applications where `payment_status = 'authorized'` and compare `authorized_at` against reminder thresholds
- Track reminders sent via individual boolean flags (`reminder_day1_sent`, `reminder_day3_sent`, `reminder_day4_sent`)
- Each committee email must include a direct link to the admin approval/rejection page for that application
- Committee email list: configurable in app settings (e.g., `COMMITTEE_EMAIL` env var or admin group)
- **Use `capture_before` from Stripe** (not a hardcoded 5 days) to calculate exact reminder times — this accounts for per-transaction variation

**Applicant notification:**
- Day 0: "Your application has been received and is under review. You will hear from us within 5 business days."

### Step 3a: Committee Approves Within 5 Days (Happy Path)

Capture the authorized PaymentIntent:

```
POST /v1/payment_intents/{pi_xxx}/capture
```

Funds are already held — capture is instant and cannot be declined. Listen for `payment_intent.succeeded` webhook → activate membership → send welcome email to applicant.

### Step 3b: Committee Rejects

Cancel the PaymentIntent to release the hold:

```
POST /v1/payment_intents/{pi_xxx}/cancel
```

Send rejection email to applicant. The hold is released and the card is never charged.

### Step 3c: 5-Day Hold Expires Without Committee Action

The PaymentIntent auto-cancels (Stripe sends `payment_intent.canceled` webhook). **The PaymentMethod remains saved on the Customer** thanks to `setup_future_usage`.

**System behaviour on expiry:**
- Set application `payment_status` to `hold_expired`
- **Admin application page:** Show a visible warning banner on the application: "⚠️ Payment hold expired. If approved now, the card will be charged directly (may require member re-authentication)."
- **Member portal:** Update applicant's status display to "Under review" (no mention of hold mechanics — they don't need to know)
- Application remains in the committee queue — they can still approve

**If committee approves after expiry** (Approach B fallback):

```
POST /v1/payment_intents
  - amount: <membership_fee_in_centimes>
  - currency: "chf"
  - customer: cus_xxx
  - payment_method: pm_xxx   ← saved from the original authorization
  - off_session: true
  - confirm: true
  - metadata: { application_id, membership_tier, approval_date }
```

This is now an off-session charge — it may succeed instantly, or it may decline/require SCA (see decline handling below).

### Step 4: Webhook Handling

Listen for:
- `payment_intent.succeeded` → activate membership, send welcome email
- `payment_intent.payment_failed` → trigger recovery flow (see Item 1 below)
- `payment_intent.canceled` → check if Stripe auto-cancel (hold expiry) → trigger Step 3c logic
- `payment_intent.requires_action` → trigger SCA recovery email (see Item 1 edge case)

---

## Items to Handle

### 1. Payment Decline / Failure (CRITICAL — Approach B fallback only)

If the committee approves within 5 days (Approach A), capture cannot fail — the funds are already held. This section only applies when the hold has expired and we fall back to an off-session charge.

The saved card may fail when charged off-session (expired, insufficient funds, bank decline, SCA re-authentication required).

**Implementation:**

- Listen for `payment_intent.payment_failed` webhook
- Set application status to `payment_failed`
- Send email to applicant:
  - Subject: "Action required — your GPC membership payment could not be processed"
  - Body: Inform them their application was approved but payment failed. Include a secure link back to the platform to update their card and retry.
- The retry page should:
  - Create a new PaymentIntent (immediate charge, no manual capture)
  - Let the user enter new card details
  - On success, activate membership
- Set a deadline (14 days from approval) after which the approval expires and they must re-apply
- Admin dashboard should surface `payment_failed` applications clearly

**Edge case — SCA required on off-session charge:**
- Stripe returns `requires_action` status with a `next_action` URL
- Email the user with a Stripe-hosted link to complete 3D Secure
- Listen for `payment_intent.succeeded` after they authenticate

### 2. Consent & Messaging (CRITICAL)

Stripe and card network rules require explicit consent before authorizing and saving a card.

**Application form must include:**

```
☑ I authorize Geneva Polo Club to charge my membership fee of CHF [amount]
  to this card upon approval of my application by the membership committee.
```

**Requirements:**
- Checkbox must be unchecked by default (user must actively opt in)
- Cannot submit application without checking the box
- Store consent timestamp and IP in the application record
- Display the exact membership fee amount — do not leave it vague
- Link to GPC membership T&Cs (cancellation policy, refund terms)

**UX copy near the card input:**
> "Your card will not be charged now. A hold of CHF [amount] will be placed
> on your card and only captured if your application is approved by the
> membership committee (typically within 5 days)."

### 3. Time Gap — Hold Expiry and Late Approvals

The 5-day authorization window is a hard Stripe/Visa constraint. The hybrid approach handles this gracefully:

**Within 5 days (Approach A):** Funds are held. Capture is instant and guaranteed. No risk.

**After 5 days (Approach B fallback):** Hold auto-releases. The saved PaymentMethod allows an off-session charge, but with these risks:
- Card may have been cancelled, expired, or hit its limit
- Bank may require re-authentication (SCA)
- User may have forgotten about the application

**Mitigations already built into the flow:**
- Committee reminder schedule (day 1, 3, 4) creates urgency to act within 5 days
- `hold_expired` warning banner on admin page makes it clear they've lost the guaranteed capture
- Member portal shows "Under review" status — applicant stays informed without extra emails
- Decline/failure recovery flow (Item 1) handles the case where the off-session charge fails
- 14-day retry deadline after late approval prevents indefinite limbo

**Optional future enhancement:**
- If late approvals become frequent, add a PaymentMethod health check via `GET /v1/payment_methods/pm_xxx` before attempting the off-session charge — check `card.exp_month`/`card.exp_year` and preemptively ask the user to update if expired
- Dashboard metric: "% of applications approved within hold window" to track committee responsiveness

---

## Stripe Configuration Notes

- **Currency:** `chf` (Swiss Francs)
- **Payment methods:** Card only for now (consider adding TWINT later)
- **Authorization window:** Treat as **5 days** (Visa minimum). Use `charge.payment_method_details.card.capture_before` from the Stripe response to get the exact expiry timestamp per transaction — store this and use it for reminder scheduling rather than a hardcoded 5 days.
- **Stripe mode:** Use test mode (`sk_test_`) for development
  - `4242 4242 4242 4242` — successful authorization and capture
  - `4000 0000 0000 9995` — decline testing
  - `4000 0027 6000 3184` — SCA required (3D Secure test)
- **Webhooks to register:**
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `payment_intent.requires_action`
  - `payment_intent.amount_capturable_updated` (confirms authorization success)
- **Webhook signature verification:** Validate using `stripe.webhooks.constructEvent()` with the endpoint signing secret
- **Idempotency:** Use `application_id` as the idempotency key when creating or capturing PaymentIntents to prevent double-charges

---

## Database Schema Additions

```
applications table:
  + stripe_customer_id        TEXT
  + stripe_payment_intent_id  TEXT
  + stripe_payment_method_id  TEXT
  + payment_status            ENUM('pending', 'authorized', 'captured', 'hold_expired',
                                   'charging_offsession', 'succeeded', 'failed',
                                   'requires_action', 'cancelled')
  + authorized_at             TIMESTAMP      (when hold was placed)
  + capture_before            TIMESTAMP      (from Stripe — exact hold expiry)
  + consent_given_at          TIMESTAMP
  + consent_ip                TEXT
  + approved_at               TIMESTAMP
  + payment_failed_at         TIMESTAMP
  + payment_retry_deadline    TIMESTAMP      (approved_at + 14 days)
  + reminder_day1_sent        BOOLEAN DEFAULT FALSE
  + reminder_day3_sent        BOOLEAN DEFAULT FALSE
  + reminder_day4_sent        BOOLEAN DEFAULT FALSE
```

---

## State Machine

```
pending
  → authorized          (PaymentIntent confirmed, hold placed)
  → failed              (card declined at application time — user retries)

authorized
  → captured            (committee approves within 5 days, capture succeeds)
  → cancelled           (committee rejects — hold released)
  → hold_expired        (5 days pass without action — hold auto-releases)

hold_expired
  → charging_offsession (committee approves late — off-session charge attempted)
  → cancelled           (committee rejects late)

charging_offsession
  → succeeded           (off-session charge works)
  → failed              (card declined)
  → requires_action     (SCA needed — user emailed)

requires_action
  → succeeded           (user completes SCA)
  → failed              (user doesn't complete within deadline)

captured → succeeded    (webhook confirms capture)

failed
  → succeeded           (user retries with new card via recovery link)
  → cancelled           (14-day retry deadline passes)
```

---

## Testing Checklist

- [ ] Happy path: apply → authorized → committee approves day 2 → capture → membership active
- [ ] Card declined at application time → user sees inline error, retries
- [ ] Committee rejects → hold released, rejection email sent, card never charged
- [ ] Committee approves at day 4 → capture still works (within 5-day window)
- [ ] Hold expires at day 5 (no committee action) → status moves to `hold_expired`, both committee and applicant emailed
- [ ] Committee approves after hold expiry → off-session charge succeeds → membership active
- [ ] Committee approves after hold expiry → off-session charge fails → applicant emailed with retry link
- [ ] SCA required on off-session charge → user emailed, completes 3D Secure → membership active
- [ ] Reminder emails fire at day 1, 3, and 4 (and not again after action is taken)
- [ ] Duplicate approval clicks → idempotency prevents double charge
- [ ] Webhook delivery failure → Stripe retries, system handles replay gracefully
- [ ] `capture_before` timestamp is stored and used (not hardcoded 5 days)
