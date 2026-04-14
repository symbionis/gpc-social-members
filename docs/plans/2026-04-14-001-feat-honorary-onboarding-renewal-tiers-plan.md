---
title: "feat: Honorary Member Onboarding + Renewal Tier Options"
type: feat
status: active
date: 2026-04-14
origin: docs/brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md
---

# feat: Honorary Member Onboarding + Renewal Tier Options

## Overview

Three changes to the membership system: (1) Honorary members can apply via a system-level `?hono=CODE` param that skips payment and goes straight to committee review, (2) self-service renewal shows category-appropriate tiers with Individual/Corporate tabs, and (3) admin can renew any expired member as honorary directly. Also removes `can_invite_honorary` from originators and the old "Activate as Free Member" button.

## Problem Frame

The new application flow with card capture works for paid tiers but breaks for honorary (free) members — the form always shows Stripe Payment Element even for price=0. The renewal flow is hardcoded to individual tiers only, blocking corporate members. There's no clean model for honorary member lifecycle. (see origin: `docs/brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md`)

## Requirements Trace

- R1. Honorary application via `?hono=CODE` param on any originator link
- R2. Honorary application skips payment step
- R3. Honorary approval auto-activates (free payment record + card + email)
- R4. Self-service renewal shows category-appropriate tiers with tabs
- R5. Admin can renew any expired member as honorary (with confirmation)
- R6. Admin can rotate the honorary invite code in settings
- R7. Existing expired/declined members applying via honorary upsert their record

## Scope Boundaries

- No auto-renewal for honorary — one-time only, renewal requires upgrade or admin action
- No corporate honorary tiers
- No individual→corporate upgrade via self-service renewal
- No public-facing honorary page — always via originator link + param

## Context & Research

### Relevant Code and Patterns

- `app/(public)/apply/[invite_code]/page.tsx` — apply page, currently filters honorary by `can_invite_honorary`
- `app/(public)/apply/[invite_code]/actions.ts` — `submitApplication` action, creates pending member
- `components/public/ApplicationForm.tsx` — two-step form (details → payment), `step` state
- `app/api/admin/applications/approve/route.ts` — approve route, legacy branch handles free tiers
- `app/api/admin/members/activate-free/route.ts` — direct free activation (to be removed)
- `components/admin/MemberDetail.tsx` — "Activate as Free Member" button (line 274), "Renew" button (line 287)
- `app/(member)/renew/page.tsx` — self-service renewal, hardcoded to individual category
- `app/(member)/renew/MemberRenewalForm.tsx` — tier selector (no tabs currently)
- `app/api/renew/member-checkout/route.ts` — renewal checkout API
- `components/admin/ApplicationQueue.tsx` — application queue with badges
- `components/admin/EmailTemplateList.tsx` — admin email settings with toggles
- `app/api/webhooks/stripe/route.ts` — `notifyCommittee()` function for committee emails

### Institutional Learnings

- Postmark Mustachio: use `{{../var}}` for parent scope, pass `null` not `""` for absent values
- Supabase inserts: always check `{ error }` return
- Stripe `payment_method_types` must match client and server

## Key Technical Decisions

- **Honorary code in `email_settings` table**: Reuses existing settings infrastructure. Key: `honorary_invite_code`, value: `{ "code": "HONORARY-2026" }`. No new table needed. Managed from the originators admin page (where invite codes live).
- **Server-side honorary validation in `submitApplication`**: The action receives the `hono` param, checks it against the stored code. If invalid or missing for a free tier, rejects the submission. This prevents bypass via direct POST.
- **Auto-activate on approve for free tiers**: The approve route checks `tier.price_eur === 0` in the new flow branch (not just legacy). When true, calls the activate-free logic inline instead of creating a Checkout Session.
- **Upsert for existing members on honorary re-application**: `submitApplication` updates the existing record when status is `expired` or `declined`, setting tier_id to honorary and status to `pending`.

## Open Questions

### Resolved During Planning

- **Q: Where does the honorary code validation happen?** → In `submitApplication` server action. The `hono` param is passed from the form. The action queries `email_settings` for the stored code and compares. The code is managed from the originators admin page (not email templates).
- **Q: How does the approve route detect free tiers?** → Before checking for payment records, it queries the member's tier. If `price_eur === 0`, it runs the free activation path (sets active, creates free payment, generates card, sends email) and skips Stripe entirely.
- **Q: Should corporate tiers show on the renewal page for individual members?** → No. Individual members see only individual tiers. Corporate members see both tabs (corporate pre-selected, can switch to individual for downgrade).

### Deferred to Implementation

- **Q: Case sensitivity of honorary code** → Recommend case-insensitive comparison
- **Q: Whether to track honorary origin on member record** → Could add a metadata flag, defer to implementation

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
Apply Page Decision Matrix:

| ?hono param | Valid code? | Tiers shown              | Payment step |
|-------------|------------|--------------------------|--------------|
| absent      | n/a        | Paid tiers (ind + corp)  | Yes (card)   |
| present     | yes        | Honorary only (price=0)  | No (skip)    |
| present     | no         | Paid tiers (ind + corp)  | Yes (card)   |

Approve Route Decision:

| Tier price | Payment record? | Action                              |
|-----------|----------------|--------------------------------------|
| > 0       | authorized      | Capture PI (existing flow)           |
| > 0       | hold_expired    | Off-session charge (existing flow)   |
| > 0       | none            | Legacy Checkout Session              |
| = 0       | any/none        | Auto-activate free + card + email    |

Renewal Page Tabs:

| Member category | Tabs shown          | Pre-selected | Honorary? |
|----------------|--------------------|--------------|-----------| 
| individual     | Individual only     | Individual   | Excluded  |
| corporate      | Corporate + Individual | Corporate | Excluded  |
| honorary       | Individual only     | Individual   | Excluded  |
```

## Implementation Units

- [ ] **Unit 1: Honorary Code Setting + Admin UI**

**Goal:** Store and manage the honorary invite code in the settings table, managed from the originators admin page (where invite links live).

**Requirements:** R6

**Dependencies:** None

**Files:**
- Modify: `components/admin/OriginatorList.tsx`
- Modify: `app/(admin)/admin/originators/page.tsx`
- Modify: `app/api/admin/email-settings/route.ts` (reuse for settings persistence)

**Approach:**
- Insert a new `email_settings` row: key `honorary_invite_code`, value `{ "code": "HONORARY-2026" }`, enabled `true`
- Add a dedicated section at the top of the originators page for the honorary invite code — input field to view/edit, save button, and a preview of the full URL format (`/apply/{originator}?hono={code}`)
- Use the existing `email-settings` PATCH API for persistence

**Patterns to follow:**
- Existing settings save pattern in `EmailTemplateList.tsx` (fetch/PATCH to `/api/admin/email-settings`)
- Originator invite link display in `OriginatorList.tsx`

**Test scenarios:**
- Happy path: Admin enters a new honorary code on originators page, saves → setting persisted
- Happy path: Admin rotates code from "OLD-CODE" to "NEW-CODE" → old code stops working, new one works
- Edge case: Empty code saved → honorary applications should be blocked (no valid code exists)

**Verification:**
- Admin can view, edit, and save the honorary invite code on the originators page

---

- [ ] **Unit 2: Apply Page Honorary Param Handling**

**Goal:** When `?hono=CODE` is present and valid, show only the honorary tier. When absent or invalid, show paid tiers only (remove `can_invite_honorary` logic).

**Requirements:** R1

**Dependencies:** Unit 1

**Files:**
- Modify: `app/(public)/apply/[invite_code]/page.tsx`
- Modify: `components/public/ApplicationForm.tsx`

**Approach:**
- Apply page reads `?hono` from searchParams
- Server-side: query `email_settings` for `honorary_invite_code`, compare (case-insensitive)
- If valid: fetch only the honorary tier (price_eur = 0), pass `isHonorary: true` to form
- If invalid or absent: fetch paid tiers only (existing behavior minus `can_invite_honorary` check)
- Remove the `can_invite_honorary` conditional from tier queries
- Pass `honoParam` to the form for server-side validation in submitApplication

**Patterns to follow:**
- Existing `?resume=memberId` param handling in the apply page
- Existing tier filtering logic

**Test scenarios:**
- Happy path: `/apply/COAST?hono=VALID_CODE` → only honorary tier shown, no other tiers
- Happy path: `/apply/COAST` (no param) → paid tiers shown, no honorary
- Error path: `/apply/COAST?hono=WRONG_CODE` → paid tiers shown (invalid code ignored)
- Edge case: `/apply/COAST?hono=valid_code` (lowercase) → should match if case-insensitive

**Verification:**
- Honorary tier visible only with valid `?hono` param
- Paid tiers visible without param or with invalid param
- `can_invite_honorary` no longer referenced in apply page

---

- [ ] **Unit 3: Application Form Skips Payment for Free Tiers**

**Goal:** When the selected tier is free (price_eur = 0), skip the payment step, hide the payment consent checkbox, and redirect to success after form submission.

**Requirements:** R2

**Dependencies:** Unit 2

**Files:**
- Modify: `components/public/ApplicationForm.tsx`
- Modify: `app/(public)/apply/[invite_code]/actions.ts`

**Approach:**
- In `ApplicationForm.tsx`: after `submitApplication` succeeds, check `currentTier.price_eur === 0`. If free, redirect to `/apply/success` immediately instead of moving to payment step
- Hide the payment consent checkbox when `currentTier?.price_eur === 0`
- Change "Authorize Hold" button text to "Submit Application" when honorary
- In `submitApplication` action: accept `honoParam` argument. When `tierId` maps to a free tier, validate `honoParam` against stored code. Reject if invalid. This prevents bypass via direct POST
- For existing expired/declined members (R7): upsert their record instead of inserting — update status to `pending`, tier_id, and any changed fields
- Send committee notification and application-received emails immediately for free tier submissions (not via webhook)

**Patterns to follow:**
- `notifyCommittee()` function in `app/api/webhooks/stripe/route.ts`
- `sendEmail()` with `application-received` template alias

**Test scenarios:**
- Happy path: Select honorary tier → submit form → no payment step shown → redirected to `/apply/success`
- Happy path: Committee receives notification email immediately after honorary submission
- Happy path: Applicant receives application-received email immediately
- Error path: POST with free tier ID but no/invalid hono param → rejected with error message
- Integration: Existing expired member applies via honorary → record upserted to pending/honorary, committee notified
- Edge case: Active member applies via honorary → blocked with "already active" message
- Edge case: Pending member retries → returns existing member_id (no duplicate)

**Verification:**
- Honorary applications complete without any Stripe interaction
- Committee is notified immediately (not via webhook)
- Server rejects free-tier submissions without valid hono param

---

- [ ] **Unit 4: Approve Route Auto-Activates Free Tiers**

**Goal:** When admin approves a pending member with a free tier, auto-activate them without Stripe — create free payment record, generate card, send member-approved email.

**Requirements:** R3

**Dependencies:** None (can be done in parallel with Units 1-3)

**Files:**
- Modify: `app/api/admin/applications/approve/route.ts`

**Approach:**
- Before checking for payment records, query the member's tier price
- If `tier.price_eur === 0`: skip all Stripe logic, directly activate
  - Set member status to `active`, `start_date`, `end_date` (1 year)
  - Insert payment row with `payment_status: "free"`, `amount_eur: 0`
  - Generate card (reuse pattern from `activateMembership` in webhook route)
  - Send `member-approved` email with card details (using `has_card` object + `../` syntax)
  - Record approval audit
  - Return success
- If `tier.price_eur > 0`: existing flow unchanged

**Patterns to follow:**
- `activateMembership()` in `app/api/webhooks/stripe/route.ts` — card generation + email sending
- `app/api/admin/members/activate-free/route.ts` — free payment record pattern

**Test scenarios:**
- Happy path: Approve pending honorary member → status becomes `active`, card generated, free payment recorded, member-approved email sent
- Happy path: Approve pending paid member → existing capture/legacy flow (unchanged)
- Integration: Honorary member receives member-approved email with card preview and portal link
- Edge case: Concurrent approve attempts → 409 conflict (existing optimistic lock still works)

**Verification:**
- Honorary approval is a single click (no extra "Activate" step)
- Member activated with card, payment record, and email in one action

---

- [ ] **Unit 5: Self-Service Renewal with Category Tabs**

**Goal:** The `/renew` page shows Individual/Corporate tabs, pre-selects the member's current category, and excludes honorary tier.

**Requirements:** R4

**Dependencies:** None (can be done in parallel)

**Files:**
- Modify: `app/(member)/renew/page.tsx`
- Modify: `app/(member)/renew/MemberRenewalForm.tsx`
- Modify: `app/api/renew/member-checkout/route.ts`

**Approach:**
- In `page.tsx`: fetch both individual and corporate tiers (excluding honorary). Query member's current tier to determine category. Pass `currentCategory` to the form
- In `MemberRenewalForm.tsx`: add Individual/Corporate tab switcher (same pattern as `ApplicationForm.tsx`). Pre-select the member's category tab. Individual members: only show Individual tab (no corporate). Corporate members: show both tabs, corporate pre-selected
- In `member-checkout/route.ts`: add validation that the selected tier has `stripe_price_id` (blocks honorary selection via API)

**Patterns to follow:**
- Tab switcher in `components/public/ApplicationForm.tsx` (lines 201-224)
- `TierSelector` component in `ApplicationForm.tsx`

**Test scenarios:**
- Happy path: Expired individual member → sees Individual tab only with paid individual tiers
- Happy path: Expired corporate member → sees Corporate tab pre-selected, can switch to Individual
- Happy path: Expired honorary member → sees Individual tab only with paid tiers (no honorary)
- Error path: API call with honorary tier_id → rejected ("not configured for payment")
- Edge case: Member with no tier_id (null) → defaults to Individual tab

**Verification:**
- Corporate members see both tabs, individual members see one tab
- Honorary tier never appears in self-service renewal
- Tab pre-selection matches member's current category

---

- [ ] **Unit 6: Admin "Renew as Honorary" Button**

**Goal:** Add a "Renew as Honorary" button on expired members in admin, with confirmation dialog, that directly activates them for free.

**Requirements:** R5

**Dependencies:** Unit 4 (shares the free activation pattern)

**Files:**
- Modify: `components/admin/MemberDetail.tsx`
- Create: `app/api/admin/members/renew-honorary/route.ts`

**Approach:**
- In `MemberDetail.tsx`: add "Renew as Honorary" button for `status === "expired"` members. Show confirmation dialog before action (same pattern as hold-expired confirm in `ApplicationQueue.tsx`)
- New API route: verify admin auth, verify member is expired, set tier_id to honorary tier, activate with free payment record + card + dates. Send `member-approved` email with card details
- Remove the "Activate as Free Member" button (line 274, only for approved members)

**Patterns to follow:**
- `handleActivateFree()` in `MemberDetail.tsx` — similar flow but for expired members
- Hold-expired confirmation dialog in `ApplicationQueue.tsx`
- Free activation pattern in `activate-free/route.ts`

**Test scenarios:**
- Happy path: Click "Renew as Honorary" on expired member → confirmation dialog → confirm → member activated as honorary, card generated, email sent
- Happy path: Works on any expired member regardless of their previous tier
- Error path: Cancel confirmation → no action taken
- Integration: Member receives member-approved email with card preview
- Edge case: Member is not expired (e.g., already active) → API returns error

**Verification:**
- "Renew as Honorary" button visible on all expired members
- "Activate as Free Member" button removed
- Confirmation required before action
- Member activated with honorary tier, card, and email

---

- [ ] **Unit 7: Cleanup — Remove `can_invite_honorary` References**

**Goal:** Remove `can_invite_honorary` from originator logic, UI, and queries throughout the codebase.

**Requirements:** R1 (cleanup)

**Dependencies:** Units 2, 5 (these units stop using `can_invite_honorary`)

**Files:**
- Modify: `components/admin/OriginatorList.tsx` — remove toggle/checkbox
- Modify: `app/api/admin/originators/route.ts` — remove PATCH handler for `can_invite_honorary`
- Modify: `app/(admin)/admin/originators/page.tsx` — remove from query
- Modify: `app/(public)/renew/[token]/page.tsx` — remove honorary filtering by originator
- Modify: `app/api/admin/members/request-renewal/route.ts` — remove `can_invite_honorary` from query
- Modify: `components/admin/UserManagement.tsx` — remove if referenced
- Modify: `app/(admin)/admin/users/page.tsx` — remove if referenced

**Approach:**
- Search all 11 files referencing `can_invite_honorary` and remove the logic
- Renewal page (`/renew/[token]`): always exclude honorary tier regardless of originator
- Originator list: remove the honorary toggle checkbox
- Do NOT drop the database column yet — just stop using it in code. Column can be dropped later via migration

**Test scenarios:**
Test expectation: none — pure removal of unused code paths. Verified by ensuring no runtime errors and existing flows still work.

**Verification:**
- `grep -r "can_invite_honorary"` returns zero results in `app/` and `components/` directories
- Originator admin page loads without errors
- Renewal page always excludes honorary tier

## System-Wide Impact

- **Interaction graph:** The approve route now branches on tier price before checking payment records. Committee notification can now come from two sources: webhook (paid) or submitApplication (free). Member-approved email sent from approve route (free) or webhook (paid).
- **Error propagation:** Free-tier approval failures should return 500 to admin with a clear error message, not silently fail.
- **State lifecycle risks:** The upsert for existing members (R7) must not lose payment history or card history from the previous membership period. Only update member fields, not cascade-delete related records.
- **API surface parity:** The `member-approved` email template is shared between paid and free flows. Both must pass the same template model shape (including `has_card` with `../` syntax).
- **Unchanged invariants:** Paid tier application flow (card auth → webhook → committee notification → approve → capture → activate) is completely unchanged. Stripe webhook handlers are not modified.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Honorary code leaked = unlimited free signups | Code is rotatable; admin can change it immediately. Applications still require committee approval. |
| Server-side validation bypass for free tier | `submitApplication` validates hono param server-side, not just client-side filtering |
| Upsert losing member history | Only update member fields (status, tier_id, company, etc.), do not touch payments or cards tables |
| Email template differences between paid/free flows | Both flows use the same `member-approved` template with the same `has_card` object shape |

## Documentation / Operational Notes

- Admin needs to set the initial honorary code in Settings after deploy
- Create `honorary_invite_code` row in `email_settings` table during deployment
- The honorary invite URL format: `https://social.genevapolo.com/apply/{ORIGINATOR_CODE}?hono={HONORARY_CODE}`

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md](docs/brainstorms/2026-04-14-honorary-onboarding-renewal-tiers-requirements.md)
- Related: `app/api/webhooks/stripe/route.ts` — `activateMembership()` and `notifyCommittee()`
- Related: `docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md` — Mustachio `{{../}}` scoping
- Related: `docs/solutions/integration-issues/stripe-supabase-payment-flow-integration-issues.md` — silent insert failures
