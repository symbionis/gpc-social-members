---
title: Honorary Member Onboarding + Renewal Tier Options
date: 2026-04-14
status: complete
scope: standard
---

# Honorary Member Onboarding + Renewal Tier Options

## Problem Frame

The new application flow with card capture works for paid tiers, but honorary (free) members hit a broken path — the form always shows the Stripe Payment Element even for price=0 tiers. Additionally, the renewal flow has gaps: self-service renewal is hardcoded to individual tiers only, corporate members can't renew, and there's no clear model for how honorary members renew.

## Requirements

### R1. Honorary Application via Param-Based Invite Code

- A system-level honorary code (e.g. `SECRET_CODE`) can be appended to any originator's invite link as `?hono=SECRET_CODE`
- When present and valid, the apply page shows **only** the honorary tier (price=0)
- The honorary code is stored in a settings table, rotatable by admin
- Remove `can_invite_honorary` from originators — the param replaces per-originator permission
- Server-side validation: `submitApplication` must verify the `hono` param against the stored code before accepting a free-tier application

### R2. Honorary Application Skips Payment

- When the selected tier has `price_eur === 0`, the application form skips the payment step entirely
- After form submission, redirect to success page (no card auth)
- Committee notification email sent immediately (not from webhook)
- Applicant receives `application-received` email immediately
- Hide the payment consent checkbox when the selected tier is free

### R3. Honorary Approval Auto-Activates

- When admin approves a pending member whose tier has `price_eur === 0`, the approve route auto-activates them:
  - Sets status to `active`, sets `start_date` and `end_date`
  - Creates a `payment_status: "free"` payment record
  - Generates a digital membership card
  - Sends `member-approved` email with card details
- No separate "Activate as Free Member" button needed — remove the old one

### R4. Self-Service Renewal Shows Category-Appropriate Tiers

- The `/renew` page shows Individual/Corporate tabs (same pattern as the apply form)
- Pre-selects the tab matching the member's current tier category
- Corporate members can switch to the Individual tab (downgrade allowed)
- Individual members only see individual tiers (no upgrade to corporate via self-service)
- Honorary tier is **always excluded** from self-service renewal — expired honorary must upgrade to a paid tier
- The renewal checkout API should validate the selected tier is active and paid (stripe_price_id required)

### R5. Admin Can Renew Any Expired Member as Honorary

- "Renew as Honorary" button on any expired member in admin member detail
- Confirmation dialog before action (same pattern as hold-expired confirm)
- Directly activates: status `active`, free payment record, new card, dates set
- Sends `member-approved` email with card details
- Available for any expired member regardless of their current tier (acts as tier override)

### R7. Existing Members Applying via Honorary Invite

- If an existing expired or declined member submits the application form via `?hono=CODE`:
  - Upsert their existing record: set `status: pending`, `tier_id` to honorary tier, update any changed fields (company, phone, linkedin, originator note, etc.)
  - They go through the standard honorary approval flow (committee reviews → admin approves → auto-activates as free)
- If the member is currently `active`: block with "This email is already associated with an active membership"
- If the member is currently `pending`: return existing member_id (allows retry of the same application)

### R6. Admin Honorary Code Management

- Admin settings page (or email templates page) includes a field to view/rotate the honorary invite code
- The code should be a simple string (e.g. `HONORARY-2026`)
- Admin can change it at any time; old code stops working immediately

## Scope Boundaries

- No auto-renewal for honorary members — honorary is one-time, renewal requires upgrade or admin action
- No corporate honorary tiers — honorary is individual only
- No public-facing honorary page — always accessed via originator link + param
- Member self-service renewal does not allow upgrade from individual to corporate

## Success Criteria

1. Visiting `/apply/COAST?hono=VALID_CODE` shows only the honorary tier, form submits without payment, committee notified
2. Visiting `/apply/COAST?hono=WRONG_CODE` or `/apply/COAST` (no param) shows paid tiers only
3. Admin approving a pending honorary member auto-activates them with card and email
4. Expired honorary member logging in sees "Renew Membership" → paid tiers only (no honorary)
5. Expired corporate member logging in sees Corporate tab pre-selected, can switch to Individual
6. Admin clicking "Renew as Honorary" on any expired member → confirmation dialog → activates for free with email
7. Expired member applying via `?hono=CODE` → existing record upserted to pending/honorary → standard approval flow
8. Active member applying via `?hono=CODE` → blocked with "already active" message

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Param-based honorary code (`?hono=`) instead of per-originator permission | Simpler, rotatable, works with any originator link. One gate instead of managing per-user permissions |
| Honorary is one-time, no self-renewal | Prevents indefinite free membership without admin oversight |
| Remove `can_invite_honorary` from originators | Replaced by the system-level param. Simplifies originator model |
| Remove "Activate as Free Member" button | Replaced by auto-activation on approve (R3) and "Renew as Honorary" (R5) |
| Tabs on renewal page matching apply form | Consistent UX, allows corporate→individual downgrade without clutter |
| Upsert existing expired members on honorary re-application | Avoids duplicate records, preserves member history, lets them update their info |
| One clean renewal flow for everyone | Self-service renewal is the same for all categories (tabs + paid tiers). Admin handles exceptions manually (honorary renewals) |

## Outstanding Questions

### Resolved

- **Q: Where to store the honorary code?** → New `email_settings` row with key `honorary_invite_code`, value contains the code string. Reuses existing settings infrastructure.
- **Q: What happens if someone manually POSTs a free tier ID without the hono param?** → Server-side validation in `submitApplication` rejects it. The tier ID alone is not enough.

### Deferred to Implementation

- **Q: Should the honorary code be case-sensitive?** → Implementation decision, but recommend case-insensitive for usability.
- **Q: Should admin see which members were invited via honorary code?** → Could be tracked via a flag or metadata on the member record. Defer to implementation.
