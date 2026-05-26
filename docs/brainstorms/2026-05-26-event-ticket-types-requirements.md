# Event Ticket Types — Requirements

**Date:** 2026-05-26
**Status:** Ready for planning (build gated — see Dependencies)
**Scope:** Deep — feature (cross-cutting data-model change; product shape inherited from existing event registration)

## Problem & Context

Events today support exactly **one** ticket type. Pricing lives as columns on the `events` row: `price_member`, `price_non_member`, and (after [#32](https://github.com/), merged) `invite_price` for invited guests on members-only events. A registration is a single `event_registrations` row carrying one `quantity` and one rate.

Organizers need more than one priced option per event — e.g. a polo brunch with:

- Standard — CHF 80
- Standard + Asado — CHF 140
- Kids — CHF 40
- Kids + Asado — CHF 80

These are not add-ons layered on a base ticket; each is its own named ticket type with its own prices. A single buyer (a family) needs to combine them — 2 standard + 2 kids — in one checkout. The current single-price, single-line model can't express this, forcing organizers to either create multiple events or collect money off-platform.

This extends the existing in-house registration system (member pricing, Stripe checkout, free path, seat caps, confirmation email, attendee list, private invite links). The product shape is inherited; this is a data-model and UI change within it.

## Goals

- An organizer can define **multiple ticket types** per event, each with a title and its own member / non-member / invited-guest prices.
- A buyer can select a **quantity per ticket type** and pay for the whole basket in one checkout.
- The existing single-price experience is preserved: every event still has a default "Standard" type, and existing events/registrations migrate cleanly with no behaviour change.
- Per-type pricing reconciles with all three rate classes already in the system: member, non-member (public events), invited guest (members-only events, via [#32](https://github.com/)).
- Seat capacity still works, counting only the ticket types that represent a seat.

## Non-Goals (v1)

- **No per-type capacity limits.** Capacity stays a single event-level `seat_cap`.
- **No separate "add-on" concept.** Extras like asado are modelled as their own ticket types (e.g. "Standard + Asado"), not as modifiers on a base ticket.
- **No per-ticket attendee names.** A registration still captures one buyer (name + email); check-in stays one toggle per registration, not per person.
- **No per-type member-eligibility rules.** If the session is an active member, the member rate applies to *every* line in the basket.
- **No mixed rate classes in one basket.** A registration is one rate class (member OR non-member OR invited guest) applied across all chosen types — determined by session/code, never by the form.
- **No discount/promo codes, waitlist-per-type, or scheduled price changes (early-bird windows).**

## Users & Primary Flows

**Buyer (member, non-member, or invited guest) on the event detail view:**
1. Opens the event (member `/events/[id]`, public `/public/events/[id]`, or public with `?code=` invite).
2. Sees each ticket type with the price for their rate class and a quantity stepper.
3. Picks quantities across one or more types; a running total updates. Total tickets 1–10.
4. Submits. Free basket → confirmation email immediately. Paid basket → Stripe Checkout → confirmation email on payment success.

**Organizer at event creation (the "draw"):**
1. Defines the ticket types up front: title + member price + (non-member price | nothing, depending on visibility) + "counts as a seat".
2. Every event starts with a "Standard" type by default; the organizer adds, renames, reorders, or removes types.

**Organizer in Manage Event → Settings (post-publish, members-only events):**
1. To open a private invite link, sets a **guest price per ticket type** (replaces today's single guest-price field).
2. Generates / copies / regenerates the link as today. Link activates only when registration is enabled *and every type has a guest price*.

**Organizer on the attendee list:**
1. Sees each registration with its per-type breakdown (e.g. "2× Standard, 2× Kids") alongside name, email, rate class, total paid, registered-at, check-in toggle.
2. CSV export reflects the same breakdown.

## Behavior Details

### Ticket types
- A ticket type has: `title`, `price_member`, `price_non_member` (public events only), `invite_price` (members-only events only), `counts_as_seat` (default true), and a display order.
- Every event has at least one type. "Standard" is the seeded default; it is a peer of the others (renamable, removable down to a minimum of one type).
- Price-presence rules mirror the existing event-level constraint, now per type:
  - **Public event:** `price_non_member` required; `invite_price` is N/A (null).
  - **Members-only event:** `price_non_member` is N/A (null); `invite_price` set later in Settings (null until then).
  - `price_member` required for every type once registration is enabled.

### Pricing resolution (unchanged in spirit, applied per type)
The rate class is decided once per registration by session + invite code — never by form input — exactly as today. The chosen class then selects which price column applies to *every* line:

| Buyer | Event visibility | Rate class | Per-line price |
|---|---|---|---|
| Logged-in active member | any | member | `price_member` |
| Logged-out / expired, valid `?code=` | members-only | invited guest | `invite_price` |
| Logged-out / non-member | public | non-member | `price_non_member` |
| Logged-out, no code | members-only | (blocked — 403) | — |

### Basket and quantity
- One quantity per ticket type; the **sum** across types must be 1–10 (preserves the existing per-registration ticket cap; replaces the current single-field 1–10).
- Display price per row is informational; the server recomputes every line's rate on submit and trusts only that.

### Free lines and Stripe
- A type priced 0 for the buyer's class is a free line: recorded as a registration item at unit 0, **omitted from Stripe `line_items`** (Stripe payment mode rejects zero-amount lines).
- If the whole basket totals 0 → skip Stripe entirely, register as free, send confirmation immediately (existing free path).
- Otherwise → one Stripe line item per *paid* type (`price_data` inline, quantity = that type's count), one combined checkout.

### Capacity
- `seat_cap` stays event-level. Seats used = sum of `quantity` across registration items whose ticket type has `counts_as_seat = true`, over paid + free registrations.
- The documented oversell-by-one trade-off on concurrent final checkouts is unchanged.

### Confirmation email & attendee list
- Confirmation email shows the per-type breakdown and the combined total (or "Free").
- Attendee list shows each registration's per-type breakdown; CSV export matches.
- The current inline per-registration quantity edit on the attendee list is **removed** — the breakdown is read-only. (Editing a single aggregate quantity no longer maps to a per-type basket; a per-type editor is deferred.)

### Waitlist
- The waitlist entry captures the desired **ticket type + quantity** at signup (single type per entry, quantity 1–N), so the organizer knows what each waitlister wants. Pricing is not resolved at waitlist time.
- Waitlist→registered conversion **drops the admin quantity input**; it creates the comped (free, seat-cap-overriding) registration directly from the type + quantity stored on the waitlist entry, as one line item.
- Multi-type baskets on the waitlist are out of scope — a waitlister picks one type.

### Invite link Settings UI (members-only)
- The single "Guest price (CHF)" field in `components/admin/EventInviteLink.tsx` becomes a per-type list (each type title + a guest-price input, saved together).
- "Activate invite link" prerequisite becomes: registration enabled **AND** every ticket type has an `invite_price`.
- `invite_code` stays one-per-event; only the *price* becomes per-type.

## Data Model (reviewed against `invite_price` + #32)

> Included because this brainstorm is inherently a data-model change. Exact constraint mechanism (trigger vs. denormalized visibility on the child) is deferred to planning.

**New `event_ticket_types`** — absorbs the three price columns currently on `events`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `event_id` | uuid fk → events | cascade delete |
| `title` | text | e.g. "Standard", "Standard + Asado", "Kids" |
| `price_member` | numeric(10,2) | required once registration enabled |
| `price_non_member` | numeric(10,2) null | public events only; null on members-only |
| `invite_price` | numeric(10,2) null | members-only only; null on public; set in Settings |
| `counts_as_seat` | boolean default true | sums toward `events.seat_cap` |
| `sort_order` | int | "Standard" sorts first |

**`event_registrations`** stays the order header (name, email, is_member, member_id, status, reference_code, stripe_*, paid_at, total). Its current single `quantity` / `unit_amount_chf` move into line items.

**New `event_registration_items`:** `registration_id` (fk, cascade), `ticket_type_id` (fk), `title_snapshot`, `quantity`, `unit_amount_chf`, `line_total_chf`.

**On `events`:** drop `price_member`, `price_non_member`, `invite_price` after backfill. Keep `visibility`, `seat_cap`, `registration_enabled`, `invite_code`.

**Migration:**
1. Create `event_ticket_types`; seed one "Standard" type per existing event from its `price_member` / `price_non_member` / `invite_price`.
2. Create `event_registration_items`; convert each existing registration into one "Standard" line item using its `quantity` / `unit_amount_chf`.
3. Drop the three price columns from `events`.

## Success Criteria

- An organizer creates an event with 3–4 ticket types at varying member/non-member prices; a family buys 2 standard + 2 kids in one checkout and pays the correct combined total.
- A member and a non-member buying the same basket are charged their respective per-type rates, decided by session.
- On a members-only event, per-type guest prices set in Settings activate the invite link; an invited guest pays the per-type `invite_price`.
- A basket containing a free type plus paid types checks out correctly (free line omitted from Stripe, recorded in our data).
- Seat-counting types fill `seat_cap`; a non-seat type does not.
- All existing events and registrations continue to work post-migration with no behaviour change; the attendee list and confirmation email render the breakdown.

## Dependencies & Assumptions

- **Build is gated on #32 being merged — now satisfied** (private invite link + `invite_price` on `events`, plus #33 e2e specs, are on `main`). This feature absorbs `invite_price` as a per-type price.
- Touches the same surfaces #32 did: `app/api/events/[id]/register/route.ts`, `app/(public)/public/events/[id]/page.tsx`, `components/public/EventRegistrationForm.tsx`, `components/admin/EventInviteLink.tsx`, the Manage Event tabs, the `events` schema, and `types/database.ts` (regenerate after migration — re-append the hand-written aliases, per `feedback_db_types_aliases`).
- Reuses existing Stripe (`getStripe()`, lazy init) and Postmark config; no new env vars expected.
- **Assumption:** rate class remains whole-registration (no mixed member/guest baskets). Confirmed in dialogue.
- **Assumption:** total tickets per registration stays capped at 1–10 across all types. Confirmed in dialogue.
- **Assumption:** CHF only, consistent with the existing registration system.

## Open Questions for Planning

- **Ticket-type deletion when registrations exist.** Archive/soft-delete vs. block deletion — `event_registration_items` reference types and snapshot the title; decide the lifecycle.
- **Per-type constraint mechanism.** Enforcing "members-only ⇒ non_member null; public ⇒ invite null" from a child row needs a trigger or a denormalized visibility flag on `event_ticket_types` — pick at planning.
- **Confirmation email template shape** for a multi-line breakdown (Mustachio block over items; see `feedback_postmark_mustachio`).
- **Attendee CSV column layout** for per-type breakdown (one column with a summary string vs. expanded columns).
- **Invite-code endpoint shape:** the current `PATCH /api/admin/events/[id]/invite-code` sets a single `invite_price`; extend to accept per-type guest prices (one call vs. per-type).

## Out of Scope / Deferred

- Per-type capacity limits.
- A separate add-on / modifier concept distinct from ticket types.
- Per-ticket attendee names and per-person check-in.
- Early-bird / time-windowed pricing, promo codes.
- Per-type waitlist *capacity or queues* (the waitlist captures a desired type + quantity, but there is one shared waitlist, not a queue per type), and multi-type waitlist baskets.
- Mixed rate classes within one registration.
