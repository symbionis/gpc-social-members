# Members-Only Event — Private Invite Link — Requirements

**Date:** 2026-05-26
**Status:** Ready for planning
**Scope:** Standard

## Problem & Context

Members-only events require login to register. The member event detail page (`app/(member)/events/[id]/page.tsx`) sits in the `(member)` route group, whose layout redirects unauthenticated visitors to `/login`; and the registration API (`app/api/events/[id]/register/route.ts`) hard-blocks members-only events for anyone without an authenticated active-member session (`if (event.visibility === "members_only" && !isMember) → 403`). The observed effect: people land on a members-only event (e.g. `https://social.genevapolo.com/events/590e4c60-7531-4855-b0d6-79403577578c`), hit the login wall, and don't register.

Login is gating two distinct groups we want to let in:
1. **Existing members** who bounce off the login step.
2. **Non-member partners** we want to invite to a members-only event, who have no account at all and currently can't register even if they wanted to.

The bet: a shareable secret link, distributed only to a select group, that lets either group register without logging in — while still nudging members to log in for their member rate — will lift registration on these events.

This is an extension of the existing event-registration system, not greenfield. Public events already support no-login registration via `/public/events/[id]`; this brings a gated version of that capability to members-only events.

## Goals

- A trusted recipient can register for a members-only event from a shared link **without logging in**.
- The same link works for both lapsed-login members and non-member partners.
- Members are nudged (not forced) to log in to get their member rate and link the registration to their account.
- Admins can generate, copy, and regenerate a per-event invite link from the event management UI.

## Non-Goals (v1)

- No per-recipient / personalised invite links — one shared code per event.
- No attribution: we do not track who registered *because of* the link vs. any other path.
- No dedicated "invite price" — the invite reuses the event's existing `price_non_member` as the flat guest price.
- No link expiry date and no separate enable/disable toggle — regenerating the code is the only revocation mechanism.
- No rate limiting / captcha on the invite form.
- No new "apply for membership" funnel changes beyond what's needed to surface the registration form.

## Users & Primary Flows

**Invited non-member partner (not logged in):**
1. Opens the shared link `…/public/events/[id]?code=XXX`.
2. Code is valid → the page shows the registration form (instead of the current "Apply for membership" block) plus a soft "Log in for your member rate" nudge.
3. Enters name + email, picks quantity.
4. Pays the flat invited/guest price (`price_non_member`) — or registers free if that price is 0.
5. Receives the standard confirmation email.

**Member who'd rather not log in:**
1. Opens the same shared link.
2. Proceeds as a guest exactly as above, paying the guest price — OR follows the "Log in for your member rate" nudge.
3. If they log in, registration applies their member rate (`price_member`) and links to their member account.

**Admin / organiser:**
1. On an existing members-only event, ensures `registration_enabled = true` and a `price_non_member` is set (0 = free for invited guests).
2. Goes to **Manage Event → Settings** (the `settings` tab in `components/admin/ManageEventTabs.tsx`), where the invite link is shown with a one-tap **Copy link** action, and shares it with the select group.
3. If the link leaks or the group changes, regenerates the code from the same Settings tab — the old link stops working immediately.

## Behavior Details

### Admin placement
- The invite link lives in **Manage Event → Settings** — the `settings` tab of `components/admin/ManageEventTabs.tsx` (rendered from `app/(admin)/admin/events/[id]/attendees/page.tsx`), alongside the existing check-in/reminder settings.
- The Settings tab shows the full shareable link (read-only) with a **Copy link** button (one-tap copy to clipboard) and a **Regenerate** action.
- When the event has no `price_non_member` set or `registration_enabled = false`, the Settings tab should make clear the link won't work yet and why (the two prerequisites), rather than silently producing a dead link.

### The invite code
- One secret code per event. The link form is `…/public/events/[id]?code=XXX` and points at the **public** (unauthenticated) event page — never the `(member)` route, which would force a login redirect and defeat the purpose.
- A valid code does two things: (a) makes the public event page render the registration form for a `members_only` event instead of the "Apply for membership" block; (b) tells the registration API to allow a members-only registration that would otherwise 403.
- Validity: the link works while the event is published and upcoming. No separate expiry.
- Revocation: admin regenerates the code; the previous link immediately 404s/falls back to the members-only "Apply" block.

### Pricing (reuses existing two-price model)
- **Not logged in** (partner or member who didn't log in): pays `price_non_member` — this is the "flat invited price." `0` = free.
- **Logged-in active member:** pays `price_member`, registration linked to their member account (`is_member = true`, `member_id` set). This is the existing register-route behaviour, unchanged.
- Member-vs-guest is still decided by the authenticated session, never by the form email (preserves the existing security property — see `app/api/events/[id]/register/route.ts`).

### The login nudge
- On the invite page, a soft prompt: "Log in for your member rate" (members), with the registration form fully usable without acting on it.
- A member who logs in and returns has a session cookie set; the register API then applies the member rate automatically. (Exact post-login return UX is a planning detail.)

### Registration mechanics (unchanged, inherited)
- Free path (resolved price = 0): insert registration `free`, send confirmation immediately.
- Paid path: Stripe Checkout → confirmation on `checkout.session.completed` webhook.
- Existing duplicate-email guard (same email can't hold a `paid`/`free` registration twice for one event) and seat-cap recount-before-insert both apply to invite-link registrations.

### Abuse / leak model
- Backstop is the existing **seat cap** plus the duplicate-email guard only.
- A leaked link allowing strangers to register at the guest price (or free) up to the seat cap is an **accepted risk** for v1, consistent with the "select group" trust model. Mitigation if it happens: regenerate the code.

## Success Criteria

- A signed-out person with a valid invite link can complete registration end-to-end for a members-only event in an incognito window.
- The same event, opened **without** the code (or with a stale code), still shows the members-only "Apply for membership" block and the register API still returns 403.
- A logged-in active member registering via the link is charged `price_member` and the registration is linked to their account.
- A logged-out registrant is charged `price_non_member` (or registers free when it is 0).
- Regenerating the code invalidates the previously shared link.

## Dependencies & Assumptions

- Reuses the existing public event page (`app/(public)/public/events/[id]/page.tsx`), registration API (`app/api/events/[id]/register/route.ts`), Stripe checkout + webhook, and confirmation email — no new payment or email infrastructure.
- **Prerequisite, not a feature:** an event must have `registration_enabled = true` and a `price_non_member` set (0 allowed) for the invite link to function. The admin UI should make this clear when generating a link.
- **Assumption:** members-only invite events do not also need to be publicly listed; reusing `price_non_member` as the invited price is unambiguous because these events are not otherwise public. If an event ever needs to be *both* publicly listed and invite-shared at different guest prices, a dedicated invite-price column would be required (deferred).
- **Assumption:** one shared code per event is sufficient; we do not need to know which invitee registered.

## Open Questions for Planning

- **Code storage:** a nullable `invite_code` column on `events` vs. a small per-event token row (the latter mirrors the existing `renewal_tokens` / `payment_retry_tokens` pattern and eases regenerate history). Pick at planning time.
- **Code validation surface:** the public page reads/validates the code server-side for rendering; the register API must independently re-validate the code on POST (don't trust the page gate alone) to prevent a direct API call bypassing the members-only 403.
- **Post-login return UX:** how a member who taps "Log in for your member rate" returns to the invite context with their session applied (redirect param back to the public invite URL, or route logged-in members to the member detail page).
- **Whether the "Apply for membership" CTA should remain** as a secondary option on the invite page for genuine non-member partners, alongside the primary register form.
- **Link format / param name** (`?code=` vs `?invite=`) and whether the code is also accepted on the member route for convenience.

## Out of Scope / Deferred

- Per-recipient invite tokens, pre-filled personal links, and who-registered-from-which-invite attribution (the heavier "tracked guest list" model — revisit if attribution becomes a real need).
- A dedicated `invite_price` column distinct from `price_non_member`.
- Link expiry dates and an explicit enable/disable toggle.
- Rate limiting / captcha on the invite registration form.
- Any change to how public events or the normal member registration flow work.
