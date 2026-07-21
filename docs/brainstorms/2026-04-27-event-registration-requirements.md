# Event Registration — Requirements

**Date:** 2026-04-27
**Status:** Ready for planning
**Scope:** Standard

## Problem & Context

The events module today is info-only: members see the calendar at `app/(member)/events`, with a detail page at `app/(member)/events/[id]`. There is no RSVP, no payment, no attendee list. We want to enable paid (and free) registration directly on the GPC platform — including for non-members via a public, shareable URL — without introducing a third-party ticketing tool.

This is greenfield: there is no failing system to replace. The bet is that owning registration in-house gives us branded checkout, member pricing, unified attendee data, and one less external dependency.

## Goals

- Members and non-members can register and pay for events.
- Each event can have a member price and a non-member price (either may be 0 for free).
- Each event is either members-only or public; public events are reachable via a shareable URL with no login required.
- Registrants receive a confirmation email that serves as their ticket.
- Organizers see an attendee list per event in the admin area, with CSV export.

## Non-Goals (v1)

- No capacity caps / waitlists.
- No QR codes or scanner-based check-in (admin list with check-in toggle is enough).
- No tier-based member pricing (honorary, family, etc. all pay the same member rate). One member price per event.
- No self-service refunds or cancellations — handled manually in Stripe by an admin.
- No registrant-facing "my tickets" page — the confirmation email is the ticket.
- No discount codes / promo codes.
- No add-ons (dinner upgrade, parking, etc.) — one ticket type per event in v1.

## Users & Primary Flows

**Active member, signed in:**
1. Sees event on `/events`, clicks through to detail page.
2. Clicks "Register", picks quantity (1–N).
3. Free event → confirmation email sent immediately.
4. Paid event → Stripe Checkout at member rate × quantity → confirmation email on payment success.

**Non-member (or anyone) on the public page:**
1. Lands on `/public/events/[slug-or-id]` from a shared link.
2. Enters name + email, picks quantity.
3. If email matches an `active` member → member rate applied automatically (no login required).
4. Otherwise → non-member rate.
5. Free event → confirmation email. Paid event → Stripe Checkout → confirmation email.

**Organizer (admin):**
1. Edits an event in `/admin/events`, sets member price, non-member price, and visibility (`members_only` | `public`).
2. After event is published, sees attendees list at `/admin/events/[id]/attendees` with name, email, member/non-member, ticket count, amount paid, registered_at, and a check-in toggle.
3. Exports CSV when needed (door list).

## Behavior Details

### Pricing
- Two prices per event: `price_member` and `price_non_member`, both nullable, both default null. Stored in event currency (CHF).
- `0` = free for that audience. `null` = registration not offered at that audience tier (e.g., `price_member = 25, price_non_member = null` means members-only registration even on a public listing — useful for "public visibility, members register only" cases). **Open for planning:** confirm whether this nuance is needed or if visibility flag alone suffices.
- Member-vs-non-member rate is determined by email lookup against `members` table where `status = 'active'` at the moment of registration, NOT by login state. Signed-in members get the rate inferred from their account.
- Quantity rule: the rate of the registrant applies to all tickets in that registration. A member buying 4 tickets → 4 × member rate. A non-member buying 4 → 4 × non-member rate.

### Visibility
- `visibility: 'members_only' | 'public'` on events.
- `members_only` events appear only on `/events` (existing member calendar). They do not have a public URL.
- `public` events appear on both `/events` and a new public listing at `/public/events`, with detail at `/public/events/[id]`.

### Free events
- If the applicable rate (member or non-member, given the registrant) resolves to 0, skip Stripe. Capture name + email + quantity, store the registration as `paid_amount = 0, payment_status = 'free'`, send confirmation email immediately.

### Paid events
- Stripe Checkout session created with `quantity × rate` as a single line item. Use existing Stripe integration pattern (lazy-getter SDK init — see `feedback_sdk_lazy_init`).
- Registration row created in `pending` state on session creation; confirmed via Stripe webhook on `checkout.session.completed`. Confirmation email sent on confirmation, not on session creation. Failed/abandoned sessions remain `pending` and don't appear on the attendee list.

### Confirmation email
- Single Postmark template. Includes event title, date/time, location, registrant name, ticket quantity, amount paid (or "Free"), and a unique registration reference (short ID).
- Mustachio-compatible (see `feedback_postmark_mustachio`).
- For quantity > 1: one email to the registrant; no per-guest emails in v1.

### Admin attendee list
- Per-event page: `/admin/events/[id]/attendees`.
- Columns: name, email, member badge (yes/no), tickets, amount paid (CHF), registered_at, checked-in toggle.
- CSV export of the same columns.
- Sorted by registered_at desc by default. Filter to show/hide checked-in is a nice-to-have, not required.

## Success Criteria

- An admin can take an existing event, set a member price + non-member price + visibility, and a registrant can complete payment end-to-end without manual intervention.
- A shareable public URL works in an incognito window with no auth.
- Member rate is correctly applied to a non-logged-in registrant whose email is in the active members table.
- Free events register without touching Stripe.
- Organizer can pull a door list (screen or CSV) the morning of the event.

## Dependencies & Assumptions

- Stripe is already configured for memberships in the same account; we'll reuse keys/config. **Assumption:** mixing event payments and membership payments in one Stripe account is acceptable (separate products/prices, but same dashboard).
- Postmark is already configured; one new template needed.
- The existing `events` table will be extended with new columns; no separate `event_registrations` table exists yet and will be added.
- Non-members who register do NOT get an account. They're stored only as registration rows (name/email).
- No GDPR/marketing-consent checkbox at v1 — to be revisited if marketing wants to use these emails downstream.

## Open Questions for Planning

- Confirm `null` vs `0` semantics for prices (see "Pricing" above) — or simplify to always-numeric prices and use a single `registration_enabled` boolean.
- Webhook idempotency strategy and how to surface payment failures to admins.
- Whether the public events list should be linked from the marketing site / homepage, or only used as an outbound shareable link per event.
- Currency: assume CHF only for v1 — confirm.
- Should the existing member events page show "Register" CTA inline, or only on the detail page?

## Out of Scope / Deferred

- Capacity, waitlists, sold-out states.
- Multiple ticket types per event (early-bird, VIP, dinner add-on).
- Tier-specific pricing (honorary discounts, family packages).
- Self-service cancellation / refund.
- QR-code check-in app.
- Registrant account / "my tickets" portal.
- Promo codes.
- Per-guest names on multi-ticket registrations.
