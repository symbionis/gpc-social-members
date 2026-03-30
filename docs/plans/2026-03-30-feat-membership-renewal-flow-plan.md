---
title: "feat: Membership Renewal Flow + Email Template Management"
type: feat
status: active
date: 2026-03-30
---

# Membership Renewal Flow + Email Template Management

## Overview

Expired members need a way to renew their membership. Rather than building a separate renewal pipeline, we reuse the existing Stripe checkout and originator system with a lightweight dedicated renewal route.

The key insight: admin selects which originator link to use for each renewal. This controls whether the Honorary tier is offered (originator has `can_invite_honorary`) or not — enabling strategic renewals without additional logic.

Additionally, active members whose membership is expiring within 30 days should automatically receive a renewal invitation. This requires a cron job and an email template management system where super admins can view, edit, and toggle automated emails on/off — all integrated with the Postmark API.

## Phases

This feature has three phases:
1. **Manual Renewal** — Admin triggers renewal from member detail page
2. **Automated Renewal Reminders** — Cron job sends reminders to expiring members
3. **Email Template Management** — Super admin page to manage Postmark templates

---

## Phase 1: Manual Renewal

### Flow

```
Admin (Member Detail)
  │
  ├─ Clicks "Request Renewal"
  ├─ Selects originator from dropdown
  │
  ▼
System
  │
  ├─ Generates one-time renewal token
  ├─ Stores token in `renewal_tokens` table (member_id, originator_id, token, expires_at)
  ├─ Sends renewal email via Postmark (`membership-renewal` template)
  │   └─ Link: /renew/[token]
  │
  ▼
Member
  │
  ├─ Opens /renew/[token]
  ├─ Sees "Welcome back, [name]"
  ├─ Sees tier selector (honorary visible only if originator.can_invite_honorary)
  ├─ Selects tier → clicks "Proceed to Payment"
  │
  ▼
Stripe Checkout
  │
  ├─ mode: "payment"
  ├─ metadata: { member_id, renewal: "true" }
  ├─ success_url: /login?payment=success
  │
  ▼
Stripe Webhook (existing handler, extended)
  │
  ├─ Detects renewal via metadata.renewal === "true"
  ├─ Creates new payment record (season: current year)
  ├─ Updates member: status → "active", tier_id → new tier
  ├─ Deactivates old card (is_active = false)
  ├─ Generates new card (12-month validity)
  ├─ Sends payment-confirmed email (existing template)
  └─ Marks renewal token as used
```

## Database Changes

### New table: `renewal_tokens`

```sql
CREATE TABLE renewal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  originator_id uuid NOT NULL REFERENCES admin_users(id),
  token text NOT NULL UNIQUE,
  used boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_renewal_tokens_token ON renewal_tokens(token);
```

- `token`: Random string (e.g., `crypto.randomUUID()`)
- `expires_at`: 30 days from creation
- `used`: Set to `true` after successful payment

No changes to existing tables needed.

## New Files

### API Routes

#### `app/api/admin/members/request-renewal/route.ts`
- **Auth:** Super admin or approval committee
- **Input:** `{ member_id, originator_id }`
- **Logic:**
  1. Validate member exists and status is `expired` (or `active` for early renewal)
  2. Validate originator exists and `invite_link_active`
  3. Generate token via `crypto.randomUUID()`
  4. Insert into `renewal_tokens` (expires_at: now + 30 days)
  5. Fetch member details + originator's `can_invite_honorary` flag
  6. Fetch tier info for the email
  7. Send renewal email via Postmark (`membership-renewal` template)
  8. Return `{ success: true, token }`

#### `app/api/renew/checkout/route.ts`
- **Auth:** None (public, token-verified)
- **Input:** `{ token, tier_id }`
- **Logic:**
  1. Validate token exists, not used, not expired
  2. Get member_id from token
  3. Get tier's `stripe_price_id` and `price_eur`
  4. If `price_eur === 0` (honorary): activate directly, no Stripe
  5. If `price_eur > 0`: create Stripe checkout session with `metadata: { member_id, renewal: "true" }`
  6. Return `{ checkout_url }` or `{ success: true, activated: true }` for free

### Pages

#### `app/(public)/renew/[token]/page.tsx`
- Server component
- Validates token (exists, not used, not expired)
- Fetches member name from token's `member_id`
- Fetches originator's `can_invite_honorary` flag
- Fetches available tiers (excluding Honorary unless originator permits)
- Renders: "Welcome back, [name]" + tier selector + "Proceed to Payment" button
- Invalid/expired/used tokens show an error message
- Uses the public layout (overlay nav)

#### `app/(public)/renew/[token]/RenewalForm.tsx`
- Client component
- Tier selector (reuse pattern from `ApplicationForm.tsx`)
- On submit: POST to `/api/renew/checkout` with `{ token, tier_id }`
- Redirects to Stripe checkout URL (or shows success for honorary)

### Email Templates

Two templates for different scenarios:

#### 1. `membership-renewal` — for expired members (admin-triggered)
- **File:** `docs/email-templates/membership-renewal.html` + `.txt`
- **Alias:** `membership-renewal`
- **Model:** `{ first_name, last_name, renewal_url }`
- **Tone:** "Welcome back" — warm, inviting, no urgency
- **Used by:** Manual admin renewal request (Phase 1)

#### 2. `membership-expiring` — for active members about to expire (automated)
- **File:** `docs/email-templates/membership-expiring.html` + `.txt`
- **Alias:** `membership-expiring`
- **Model:** `{ first_name, last_name, expiry_date, renewal_url }`
- **Tone:** "Don't miss the season" — friendly nudge with specific expiry date
- **Used by:** Automated cron reminder (Phase 2)

Note: Both use `{{.}}` inside `{{#renewal_url}}` block per Postmark Mustachio gotcha (see `docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md`).

### Admin UI

#### `components/admin/MemberDetail.tsx` — modifications
- Add "Request Renewal" button (visible when member status is `expired` or `active`)
- Originator dropdown (fetched from `admin_users` where `is_originator = true`)
- On click: POST to `/api/admin/members/request-renewal`
- Show confirmation: "Renewal email sent to [member email]"

## Stripe Webhook Extension

**File:** `app/api/webhooks/stripe/route.ts`

Extend the existing `checkout.session.completed` handler:

```typescript
// After existing payment + card generation logic:
if (session.metadata?.renewal === "true") {
  // Deactivate old cards
  await supabase
    .from("membership_cards")
    .update({ is_active: false })
    .eq("member_id", memberId)
    .neq("id", newCardId);

  // Mark renewal token as used
  await supabase
    .from("renewal_tokens")
    .update({ used: true })
    .eq("member_id", memberId)
    .eq("used", false);
}
```

The existing webhook already:
- Creates payment record ✓
- Sets member status to `active` ✓
- Generates new card with 12-month validity ✓
- Sends payment-confirmed email ✓

Only additions: deactivate old cards + mark token used.

## Honorary Renewal (No Payment)

When a member selects an honorary tier (`price_eur === 0`), the `/api/renew/checkout` route handles it directly:

1. Update member: `status = "active"`, `tier_id = honorary_tier_id`
2. Create payment record: `amount_eur: 0`, `payment_status: "free"`, `season: currentYear`
3. Deactivate old card, generate new card
4. Mark renewal token as used
5. Send payment-confirmed email
6. Return `{ success: true, activated: true }` (no Stripe redirect)

Follows the same pattern as `app/api/admin/members/activate-free/route.ts`.

---

## Phase 2: Automated Renewal Reminders

### Flow

```
Cron Job (daily, e.g. 08:00 UTC)
  │
  ├─ Query: active members where card.valid_until <= TODAY + 30 days
  ├─ Filter: exclude members who already have an unused renewal token
  │
  ▼
For each expiring member:
  │
  ├─ Use the member's attributed originator_id (honorary visibility based on their originator)
  ├─ Generate renewal token (same as Phase 1)
  ├─ Send renewal email via Postmark (`membership-renewal` template)
  │
  ▼
Member receives email → same /renew/[token] flow as Phase 1
```

### Database Changes

#### New table: `email_settings`

```sql
CREATE TABLE email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users(id)
);
```

Seed with:
```sql
INSERT INTO email_settings (key, value, enabled) VALUES
  ('auto_renewal_reminder', '{"days_before_expiry": 30}', false);
```

- `enabled`: Toggle automated emails on/off from admin UI
- `value.days_before_expiry`: How many days before expiry to send (default 30)
- No default originator needed — auto-renewals use each member's attributed `originator_id`

#### Backfill: existing members without originator

All existing members without an `originator_id` should be attributed to the FRANK-GPC-2026 originator:

```sql
UPDATE members
SET originator_id = (
  SELECT id FROM admin_users WHERE invite_code = 'COAST' LIMIT 1
)
WHERE originator_id IS NULL;
```

### New Files

#### `app/api/cron/renewal-reminders/route.ts`
- **Auth:** Vercel CRON_SECRET header (or internal secret for Railway)
- **Logic:**
  1. Check `email_settings` where `key = 'auto_renewal_reminder'` and `enabled = true`
  2. If disabled, return early
  3. Get `days_before_expiry` from settings
  4. Query active members with `membership_cards.valid_until` within the window
  5. Exclude members who already have an unused `renewal_token`
  6. Exclude members without an `originator_id` (log warning)
  7. For each: generate token using member's own `originator_id`, send `membership-expiring` email
  7. Return `{ sent: N, skipped: N }`

#### `vercel.json` / Railway cron config
```json
{
  "crons": [{
    "path": "/api/cron/renewal-reminders",
    "schedule": "0 8 * * *"
  }]
}
```

For Railway: use a scheduled task or an external cron service (e.g., cron-job.org) hitting the endpoint with a secret header.

---

## Phase 3: Email Template Management

### Overview

A super-admin-only page that integrates with the Postmark API to:
- List all Postmark templates (name, alias, subject, active/inactive)
- View and edit template HTML and text body
- Preview templates with sample data
- Toggle automated email settings on/off

### Postmark API Integration

Uses the existing `postmark` npm package's `ServerClient`:

```typescript
// List templates
client.getTemplates({ count: 50, offset: 0 })

// Get template by alias
client.getTemplate("membership-renewal")

// Update template
client.editTemplate("membership-renewal", {
  Subject: "...",
  HtmlBody: "...",
  TextBody: "..."
})
```

### New Files

#### `app/api/admin/email-templates/route.ts`
- **Auth:** Super admin only
- **GET:** List all Postmark templates via API
- **Returns:** `{ templates: [{ alias, name, subject, active }] }`

#### `app/api/admin/email-templates/[alias]/route.ts`
- **Auth:** Super admin only
- **GET:** Fetch single template (HTML body, text body, subject)
- **PATCH:** Update template (subject, HTML body, text body)

#### `app/api/admin/email-settings/route.ts`
- **Auth:** Super admin only
- **GET:** Fetch all email settings from `email_settings` table
- **PATCH:** Update a setting (toggle `enabled`, update `value`)

#### `app/(admin)/admin/email-templates/page.tsx`
- Server component
- Lists all Postmark templates with their status
- Shows automated email toggles (from `email_settings` table)
- Links to individual template editor

#### `app/(admin)/admin/email-templates/[alias]/page.tsx`
- Template editor page
- Shows subject, HTML body (code editor), text body
- Preview panel with sample data
- Save button → PATCH to API

#### `components/admin/EmailTemplateList.tsx`
- Client component
- Template table with alias, name, subject
- Automated email toggles:
  - Auto-renewal reminders: on/off + days before expiry (uses each member's attributed originator)
- Click row → navigate to editor

#### `components/admin/EmailTemplateEditor.tsx`
- Client component
- Subject input
- HTML body textarea (monospace, full-width)
- Text body textarea
- Sample data preview (renders template variables with example values)
- Save + Cancel buttons

### Admin Sidebar Update

Add "Email Templates" link for super_admin:
```typescript
...(isSuper
  ? [
      { href: "/admin/tiers", label: "Tiers", icon: "layers" },
      { href: "/admin/users", label: "Users", icon: "shield" },
      { href: "/admin/email-templates", label: "Email Templates", icon: "mail" },
    ]
  : []),
```

---

## Acceptance Criteria

### Phase 1: Manual Renewal
- [ ] Admin can click "Request Renewal" on expired or active member's detail page
- [ ] Admin selects originator from dropdown — controls honorary tier visibility
- [ ] Member receives renewal email with link to `/renew/[token]`
- [ ] Renewal page shows member name, tier selector, and payment button
- [ ] Honorary tier only visible when originator has `can_invite_honorary`
- [ ] Paid tiers go through Stripe checkout → webhook reactivates + new card
- [ ] Honorary renewals activate directly without Stripe
- [ ] Old cards deactivated, new card generated with 12-month validity
- [ ] Expired/used/invalid tokens show error page
- [ ] Token expires after 30 days

### Phase 2: Automated Renewal Reminders
- [ ] Cron job runs daily and identifies members expiring within configured window
- [ ] Members with existing unused tokens are skipped (no duplicate emails)
- [ ] Default originator is used for automated renewals
- [ ] Automated reminders can be toggled on/off from admin UI
- [ ] Days-before-expiry is configurable

### Phase 3: Email Template Management
- [ ] Super admin can view all Postmark templates
- [ ] Super admin can edit template subject, HTML body, and text body
- [ ] Changes save directly to Postmark via API
- [ ] Automated email settings (auto-renewal) are toggleable with originator selection
- [ ] Email Templates link appears in admin sidebar for super admins only

## References

- Stripe checkout pattern: `app/api/email/welcome/route.ts:55-66`
- Webhook handler: `app/api/webhooks/stripe/route.ts:28-107`
- Free activation: `app/api/admin/members/activate-free/route.ts`
- Card generation: `lib/utils/card.ts`
- Postmark template gotcha: `docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md`
- Railway origin gotcha: `docs/solutions/integration-issues/railway-nextjs-auth-redirect-internal-origin.md`
- Lazy singleton pattern: `docs/solutions/build-errors/third-party-sdk-env-vars-at-module-load.md`
