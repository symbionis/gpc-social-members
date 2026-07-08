---
title: "feat: Convert Ticket Type (self-service, upgrade-only)"
type: feat
date: 2026-07-08
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
depth: standard
---

# feat: Convert Ticket Type (self-service, upgrade-only)

## Summary

Let a Lead change **one** of their Tickets to a different Ticket Type of the **same-or-higher** price from their Booking Page, paying the price difference through Stripe. The Ticket keeps its credential/QR and `is_lead` flag; the Registration's `quantity` and the Event's seat usage are unchanged. Immediate driver: attendees of the **Bohemian Chic Polo Party** (`a82d3b71-e5e3-4c15-b5c0-93c3cc905b17`) bought free standard (no-food) Tickets and now want the paid food Ticket Type.

The whole flow mirrors the existing **Top-up** architecture: a pending conversion record → Stripe Checkout carrying a data-driven metadata id → a webhook branch that applies it (idempotently) **before** the paid short-circuit → a new `SECURITY DEFINER` RPC that swaps the Ticket's `ticket_type_id` and reconciles `event_registration_items`.

**Product Contract preservation:** No upstream `ce-brainstorm` doc; this plan is the source of truth (`product_contract_source: ce-plan-bootstrap`).

---

## Problem Frame

A Ticket row carries a `ticket_type_id` but **no price** — all money lives in `event_registration_items` (line items) plus the Registration totals. So changing a Ticket's type is two coupled mutations that must happen atomically:

1. **Swap** `tickets.ticket_type_id` (from → to).
2. **Reconcile** `event_registration_items`: −1 quantity on the from-type line, +1 on the to-type line, and add the price delta to `event_registrations.total_amount_chf`.

Step 2's quantity reconciliation is not optional bookkeeping. `mint_registration_tickets` (`supabase/migrations/20260622180000_mint_registration_tickets.sql`) is idempotent **because** it compares `sum(line_item.quantity)` per type against the live Ticket count per type. If a Ticket's type is swapped without adjusting line-item quantities, the next mint — which the very same Registration triggers on any later Top-up — sees a phantom shortfall for the new type and an orphan for the old, re-minting or mis-counting. The RPC must keep both in lockstep.

`release_ticket` is the wrong primitive here (it re-mints a replacement to keep the slot open for a door swap and refuses the Lead), and Top-up alone cannot change an existing Ticket's type. A dedicated convert path is required.

---

## Requirements

- **R1** — A Lead can convert one Ticket to another Ticket Type from the Booking Page, authenticated by the Registration's `manage_token`.
- **R2** — Conversion is **upgrade-only**: the target type's price at the Registration's Rate Class must be ≥ the current type's price (delta ≥ 0). Downgrades are rejected.
- **R3** — Pricing is re-derived server-side from the Registration's stored Rate Class signal (`is_member`), never from client input, reusing the Top-up expression `is_member ? price_member : (price_non_member ?? invite_price)`.
- **R4** — When the delta is > 0, the Lead pays the difference via Stripe Checkout before the conversion applies. When the delta is 0, it applies immediately with no checkout.
- **R5** — Applying a conversion swaps `ticket_type_id`, reconciles line items (−1 from, +1 to), and bumps `total_amount_chf` by the delta. It preserves the Ticket's `credential_token`, `is_lead`, name/contact, and leaves `quantity` unchanged.
- **R6** — Only `issued` or `claimed` Tickets that are **not** checked-in, **not** released, and **not** forwarded (`batch_token IS NULL`) are eligible.
- **R7** — Apply is idempotent under webhook replay (keyed on the conversion id), and safe against a Ticket that changed state between checkout and webhook (returns a conflict rather than corrupting state).
- **R8** — Seat capacity is re-checked only when the target type consumes a seat and the source type did not (`to.counts_as_seat && !from.counts_as_seat`).

---

## Key Technical Decisions

**KTD1 — Mirror the Top-up flow, don't extend it.** A separate route (`convert/`), a separate pending table (`event_ticket_type_conversions`), and a separate RPC (`apply_ticket_type_conversion`) rather than overloading `event_registration_topups`. Top-up *adds quantity and mints*; convert *swaps a type and reconciles* — opposite mutations, so sharing the table would muddy both invariants. Follow `app/api/public/bookings/[token]/topup/route.ts` and `supabase/migrations/20260622220000_registration_topups.sql` structurally.

**KTD2 — Snapshot prices into the conversion row.** Store `from_unit_chf`, `to_unit_chf`, `delta_chf`, `from_type_id`, `to_type_id`, and `ticket_id` at record creation (route side). The RPC consumes the snapshot and does **not** re-derive pricing, so an admin editing ticket-type prices between checkout and webhook can't change what the customer agreed to pay. Mirrors how Top-up snapshots `items` jsonb.

**KTD3 — Webhook branch keys on the conversion id directly (data-driven), not a boolean flag.** Per `docs/solutions/logic-errors/stripe-webhook-metadata-missing-skips-cleanup.md`: a `conversion === "true"` string flag can be present at checkout creation and missing at delivery. Gate the branch on `session.metadata?.conversion_id` presence. Place it alongside the Top-up branch, **before** the paid short-circuit, because the Registration is already `paid`.

**KTD4 — The RPC re-verifies the Ticket is still the from-type under a row lock.** Guards (belongs to this Registration, `released_at IS NULL`, `checked_in_at IS NULL`, `batch_token IS NULL`, `slot_status IN ('issued','claimed')`, and `ticket_type_id = from_type_id`) run inside the RPC `FOR UPDATE`, mirroring `fill_ticket` (`supabase/migrations/20260622200000_manage_token_and_fill_ticket.sql`). If any fail → return `conflict` (not applied); the webhook tags the PaymentIntent `needs_refund: "conversion_conflict"`. This is the one **new** manual-refund case, consistent with the existing `needs_refund` handling for Top-up/duplicate.

**KTD5 — Line-item reconciliation is quantity-preserving per type.** The RPC decrements one from-type line by 1 (deleting it if it reaches 0) and increments/inserts the to-type line by 1 at `to_unit_chf`, then adds `delta_chf` to `total_amount_chf`. This keeps `mint_registration_tickets`' per-type invariant intact. Defensive: if no from-type line with `quantity >= 1` exists, still swap the type, insert the to-type line, add the delta, and log — never write a negative quantity.

**KTD6 — Same `is_child` on both sides.** Reject a conversion where `to_type.is_child <> from_type.is_child`. Child↔adult conversion changes waiver/contact invariants and is out of scope; blocking it keeps the RPC free of contact-revalidation logic.

**KTD7 — New RPC grant hardening.** New `SECURITY DEFINER` functions use `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` — `FROM PUBLIC` alone leaves them anon-callable on Supabase (`docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md`). Mirror `fill_ticket`'s grant block.

---

## High-Level Technical Design

*Directional — prose and the Implementation Units are authoritative where they disagree.*

Paid conversion, end to end:

```mermaid
sequenceDiagram
    participant Lead as Lead (Booking Page)
    participant Route as POST /bookings/[token]/convert
    participant DB as Supabase
    participant Stripe
    participant WH as Stripe webhook

    Lead->>Route: { ticketId, toTicketTypeId }
    Route->>DB: load reg (manage_token), ticket, from/to types
    Route->>Route: price both at rate class; delta = to - from
    alt delta < 0
        Route-->>Lead: 400 (downgrades not supported)
    else delta == 0
        Route->>DB: insert conversion (pending); rpc apply_ticket_type_conversion
        Route-->>Lead: redirect ?converted=1
    else delta > 0
        Route->>DB: insert conversion (pending, snapshot prices)
        Route->>Stripe: Checkout (1 line = delta), metadata.conversion_id
        Route-->>Lead: redirect to Stripe
        Stripe-->>WH: checkout.session.completed
        WH->>WH: branch on metadata.conversion_id (before paid short-circuit)
        WH->>DB: rpc apply_ticket_type_conversion(conversion_id)
        DB-->>WH: applied | already | conflict | not_found
        WH->>Stripe: (conflict/not_found) tag PaymentIntent needs_refund
        WH->>DB: (applied) best-effort resend confirmation email
    end
```

`apply_ticket_type_conversion` internal shape (mirrors `apply_registration_topup`):

```
lock conversion FOR UPDATE
  status = 'applied' -> return {status:'already'}
lock registration FOR UPDATE
load ticket FOR UPDATE with all KTD4 guards incl. ticket_type_id = from_type_id
  not found / guards fail -> return {status:'conflict'}
UPDATE tickets SET ticket_type_id = to_type_id WHERE id = ticket_id
-- line-item reconciliation (KTD5)
decrement one from-type line by 1 (delete if 0)
increment/insert to-type line by 1 at to_unit_chf
UPDATE event_registrations SET total_amount_chf = total_amount_chf + delta_chf
UPDATE conversion SET status='applied', applied_at=now()
return {status:'applied'}
```

---

## Implementation Units

### U1. Migration: `event_ticket_type_conversions` table + `apply_ticket_type_conversion` RPC

**Goal:** Persist a pending conversion and apply it atomically with quantity-preserving line-item reconciliation.
**Requirements:** R5, R6, R7, KTD1, KTD2, KTD4, KTD5, KTD6, KTD7
**Dependencies:** none
**Files:**
- `supabase/migrations/20260708120000_ticket_type_conversions.sql` (create)
- `types/database.ts` (regenerate for the new table; re-append the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases after regen)

**Approach:**
- Table `event_ticket_type_conversions`: `id`, `registration_id` (FK → `event_registrations` ON DELETE CASCADE), `ticket_id`, `from_type_id`, `to_type_id`, `from_unit_chf`, `to_unit_chf`, `delta_chf`, `status text CHECK IN ('pending','applied') DEFAULT 'pending'`, `created_at`, `applied_at`. Mirror `supabase/migrations/20260622220000_registration_topups.sql`.
- Enable RLS on the new table (`alter table public.event_ticket_type_conversions enable row level security;`) with no anon/authenticated policies, matching the mirrored `registration_topups` migration — service-role-only in fact, not just by convention.
- RPC `apply_ticket_type_conversion(p_conversion_id uuid) RETURNS jsonb`, `SECURITY DEFINER`, `SET search_path = public`. Structure per the HTD sketch. Return `jsonb_build_object('status', ...)` with `already` / `conflict` / `applied` / `not_found`.
- Guards inside `FOR UPDATE` exactly as KTD4, including `ticket_type_id = from_type_id` (the double-apply / drift guard).
- Line-item reconciliation per KTD5, including the defensive no-from-line branch.
- Grant block per KTD7 (`REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`).

**Patterns to follow:** `apply_registration_topup` (row-lock + idempotent applied-flip), `fill_ticket` (ticket guards under `FOR UPDATE OF t`, grant block), `mint_registration_tickets` (per-type quantity invariant this RPC must preserve).

**Execution note:** Dev and prod share one Supabase database (see the header comment convention in existing migrations) — this migration is additive (new table + new function) and safe to apply live, but state that explicitly in the migration header.

**Test scenarios** (pgTAP-style or via a route/integration test that drives the RPC through `createAdminClient`):
- Applies a pending conversion: `issued` ticket's `ticket_type_id` flips from → to; from-line quantity −1, to-line +1 (inserted if absent); `total_amount_chf += delta`; `quantity` unchanged; `credential_token` and `is_lead` unchanged. *Covers R5.*
- Idempotent replay: calling twice with the same id returns `applied` then `already`; no double line-item mutation, no double total bump. *Covers R7.*
- Conflict — ticket checked-in between record and apply: returns `conflict`, nothing mutated.
- Conflict — ticket already converted (its `ticket_type_id != from_type_id`): returns `conflict`, nothing mutated.
- Conflict — ticket released (`released_at` set) or forwarded (`batch_token` set): returns `conflict`.
- Not found — unknown conversion id: returns `not_found`.
- From-type line at quantity 1 is deleted (not left at 0) after decrement; to-type line created at `to_unit_chf` with quantity 1.
- Defensive: conversion whose from-type has no matching line item still swaps type + inserts to-line + adds delta, writes no negative quantity, logs.
- Post-conversion `mint_registration_tickets` on the same registration is a no-op (per-type sums equal live ticket counts) — proves the invariant held. *Covers R7.*
- Grants: `has_function_privilege('anon', ..., 'EXECUTE')` is false after migration. *Covers KTD7.*

### U2. Convert route: `POST /api/public/bookings/[token]/convert`

**Goal:** Authenticate the Lead, price the delta, enforce upgrade-only + eligibility + seat cap, record the pending conversion, and route to Stripe or apply inline.
**Requirements:** R1, R2, R3, R4, R6, R8, KTD2, KTD6
**Dependencies:** U1
**Files:**
- `app/api/public/bookings/[token]/convert/route.ts` (create)
- `app/api/public/bookings/[token]/convert/route.test.ts` (create)

**Approach:**
- Clone the shape of `app/api/public/bookings/[token]/topup/route.ts`: `manage_token` lookup, gate `status IN ('paid','free')`, UUID validation, `bad()` helper.
- Body `{ ticketId, toTicketTypeId }` (validate both as UUIDs).
- Load the target Ticket; enforce R6 eligibility (`registration_id` matches, `released_at IS NULL`, `checked_in_at IS NULL`, `batch_token IS NULL`, `slot_status IN ('issued','claimed')`). Read its current `ticket_type_id` as `from`.
- Load `from` and `to` `event_ticket_types`; reject if `to` archived, or `to.is_child <> from.is_child` (KTD6).
- Price both at the Registration's rate: `is_member ? price_member : (price_non_member ?? invite_price)`; reject on null/misconfigured price (mirror topup route lines 86–89). `delta = toUnit − fromUnit`; reject `delta < 0` (R2).
- Seat cap (R8): only when `to.counts_as_seat && !from.counts_as_seat`, verify `getSeatsUsed(...) + 1 <= seat_cap` using `lib/events/seat-usage.ts`.
- Insert the pending `event_ticket_type_conversions` row with snapshotted prices (KTD2).
- `delta === 0` → call `apply_ticket_type_conversion` inline, return `{ ok, applied: true, redirectUrl: .../bookings/[token]?converted=1 }`.
- `delta > 0` → create Stripe Checkout (`mode: "payment"`, one CHF line item `unit_amount = round(delta*100)`, product name like `"Upgrade to {toTitle}"`), `metadata: { event_registration_id, event_id, conversion_id }`, success `?converted=1`, cancel `?convert=cancelled`.

**Patterns to follow:** `topup/route.ts` (pricing, seat-cap guard, pending-row insert, Stripe session, success/cancel URLs), `topup/route.test.ts` (test harness + Stripe/Supabase mocking).

**Test scenarios:**
- Happy path, delta > 0: returns a `checkoutUrl`; a pending conversion row exists with correct snapshot; no ticket mutation yet.
- Happy path, delta == 0: applies inline, returns `redirectUrl`, ticket type swapped.
- Downgrade rejected: `toUnit < fromUnit` → 400, no row inserted. *Covers R2.*
- Ineligible ticket: checked-in / released / forwarded / wrong registration → 4xx, no row. *Covers R6.*
- Rate-class pricing: member vs non-member vs invite-only (members-only event, `price_non_member` null) resolves the right `to`/`from` units; misconfigured (null) price → 500. *Covers R3.*
- Child/adult mismatch (`to.is_child <> from.is_child`) → 400. *Covers KTD6.*
- Seat cap: converting a non-seat type to a seat type when the event is full → 409; seat-neutral conversion skips the check. *Covers R8.*
- Booking not confirmed (`pending`) or bad `manage_token` → 4xx.

### U3. Webhook branch: apply conversion on `checkout.session.completed`

**Goal:** Apply a paid conversion idempotently before the paid short-circuit, with a durable refund signal on unrecoverable states.
**Requirements:** R4, R7, KTD3
**Dependencies:** U1, U2
**Files:**
- `app/api/webhooks/stripe/route.ts` (modify — add branch after the Top-up branch, before the existing-registration lookup at ~line 238)
- `app/api/webhooks/stripe/route.test.ts` (modify/create — add conversion cases)

**Approach:**
- Inside `checkout.session.completed`, after the Top-up branch: read `conversionId = session.metadata?.conversion_id` (data-driven presence check, KTD3). If present:
  - `rpc apply_ticket_type_conversion({ p_conversion_id })`.
  - `applyErr` → return 500 (Stripe retries).
  - `status === 'not_found'` → tag PaymentIntent `needs_refund: "conversion_not_found"` (best-effort), return `{ received: true }`.
  - `status === 'conflict'` → tag PaymentIntent `needs_refund: "conversion_conflict"` (best-effort), return `{ received: true }`.
  - `status === 'applied'` → best-effort `sendEventRegistrationConfirmation(eventRegistrationId)` (updated type/price, same QRs); `already` skips the email. Return `{ received: true, conversion: status }`.
- Do **not** call `mintRegistrationTickets` (quantity unchanged; nothing to mint).

**Patterns to follow:** the Top-up branch in the same file (~lines 179–236) — same `needs_refund` PaymentIntent tagging, same before-short-circuit placement, same 500-for-retry vs ack-and-flag discipline.

**Test scenarios:**
- Applied: event with `conversion_id` → RPC applied, updated confirmation email sent once, 200. *Covers R4.*
- Idempotent replay: same event id twice → single application, no duplicate email, 200. *Covers R7.*
- Conflict: RPC returns `conflict` → PaymentIntent tagged `needs_refund: "conversion_conflict"`, 200 (no retry loop). *Covers KTD4.*
- Not found: unknown `conversion_id` → tagged `conversion_not_found`, 200.
- RPC error (transient) → 500 so Stripe retries.
- Metadata without `conversion_id` falls through to the existing registration/top-up paths unchanged (no regression). *Covers KTD3.*

### U4. Booking Page: per-ticket "Change ticket type" affordance

**Goal:** Surface conversion on the Booking Page for eligible tickets, offering only same-or-higher-priced target types.
**Requirements:** R1, R2, R6, KTD6
**Dependencies:** U2
**Files:**
- `app/(checkin)/public/bookings/[token]/page.tsx` (modify — pass a `convertEndpoint` and per-type price/`counts_as_seat`/`is_child` data)
- `components/public/BookingManager.tsx` (modify — add the per-ticket convert UI)
- `components/public/BookingManager.test.tsx` (modify/create if a test file exists for this component; otherwise add one)

**Approach:**
- In `page.tsx`, extend the ticket-type projection to include numeric `price` (at the booking rate — note the current `buyableTypes` uses `is_member ? price_member : price_non_member` and does **not** fall back to `invite_price`; use the same fallback as the route so invite-only food types still appear), `is_child`, and each ticket's current type id, so the client can compute eligible targets. Pass `convertEndpoint={`/api/public/bookings/${token}/convert`}`.
- In `BookingManager`, add a "Change ticket type" control on each ticket that is not checked-in, not forwarded, and has at least one target type with `price >= currentTypePrice` and matching `is_child`. On confirm, POST `{ ticketId, toTicketTypeId }`; on `checkoutUrl` redirect to Stripe, on `redirectUrl` (delta 0) navigate/refresh.
- Reuse the existing top-up/forward action styling and the `variant="booking"` conventions already in `BookingManager`.

**Patterns to follow:** the existing Top-up ("buy more") and forward controls in `components/public/BookingManager.tsx`; the `buyableTypes` projection in `app/(checkin)/public/bookings/[token]/page.tsx` (lines 109–127).

**Execution note:** Mostly UI wiring over an already-tested API. Prefer a component test for the eligibility filtering (which tickets show the control, which target types are offered) plus a manual smoke of the redirect; deep unit coverage of the network call is lower value than U1–U3.

**Test scenarios:**
- Eligibility: control shown for `issued`/`claimed` non-checked-in, non-forwarded tickets; hidden for checked-in, forwarded, or released. *Covers R6.*
- Target filtering: only types priced ≥ the ticket's current type and with matching `is_child` are offered; downgrade targets absent. *Covers R2.*
- Submit → `checkoutUrl` triggers redirect; delta-0 `redirectUrl` refreshes the page.
- A booking whose only tickets are checked-in shows no convert control.

---

## Scope Boundaries

**In scope:** Self-service, Lead-initiated, single-ticket, upgrade-only (delta ≥ 0) conversion with Stripe payment of the difference; the migration, route, webhook branch, and Booking Page UI above.

**Out of scope (non-goals):**
- Downgrades and any refund of a negative difference.
- Admin- or Door-Console-initiated conversion.
- Multi-ticket / whole-party batch conversion in one action.
- Child↔adult ticket-type conversion (blocked by KTD6).

### Deferred to Follow-Up Work
- **Feature B — Cancel free ticket** (release a free, non-lead Ticket with `quantity` decrement + line-item reconciliation, no re-mint): a separate plan. Not required to solve the Bohemian Chic case once convert ships.
- **Surfacing `needs_refund`-tagged PaymentIntents to an admin.** Convert adds a new `conversion_conflict` reason to the existing manual-refund-by-Stripe-tag debt; a queryable admin view is worth its own ticket.

---

## Open Questions

- **OQ1 (deferred to implementation):** exact `event_registration_items` decrement strategy when multiple from-type lines exist (pick the highest-quantity line, or the oldest?). Either is correct for the invariant; decide when touching real rows. Default: oldest by `created_at`.
- **OQ2 (product, non-blocking):** should the updated confirmation email explicitly call out "your ticket was upgraded to {type}", or just re-send the standard confirmation? Default: standard re-send (U3), refine copy later if desired.

---

## System-Wide Impact & Risks

- **Payments / manual refund:** a conversion charged but not applicable (checked-in or re-converted between checkout and webhook) charges the customer and flags `needs_refund: "conversion_conflict"` for manual handling — same accepted pattern as Top-up/duplicate today. Low frequency; mitigated by the pre-checkout eligibility check in U2 narrowing the race window.
- **Mint invariant coupling:** the highest-risk correctness surface. If U1's line-item reconciliation is wrong, a later Top-up's mint mis-counts. The U1 test that runs `mint_registration_tickets` post-conversion and asserts a no-op is the guardrail — treat it as required.
- **Shared dev/prod database:** the migration applies to production immediately on merge/deploy (per existing migration convention). It is additive (new table + new function), so no data backfill or destructive change. **Deploy order:** apply the U1 migration to the shared database before (or atomically with) deploying U2–U4 — migration-before-code is safe (unused table/function); code-before-migration produces 500s (webhook retry loop, delta-0 inline apply) until the RPC/table exist.
- **Rate-class re-derivation:** the Registration stores only `is_member`, so invite-only pricing depends on the `price_non_member ?? invite_price` fallback being applied in both the route (U2) and the Booking Page projection (U4). A mismatch would hide the food type from invited guests (as the current `buyableTypes` projection already would) — U4 explicitly fixes this.

---

## Sources & Research

- **Local template:** `app/api/public/bookings/[token]/topup/route.ts`, `app/api/public/bookings/[token]/topup/route.test.ts`, `supabase/migrations/20260622220000_registration_topups.sql` (`apply_registration_topup`).
- **Guards template:** `supabase/migrations/20260622200000_manage_token_and_fill_ticket.sql` (`fill_ticket`).
- **Invariant this plan must preserve:** `supabase/migrations/20260622180000_mint_registration_tickets.sql`.
- **Webhook placement + refund tagging:** `app/api/webhooks/stripe/route.ts` (Top-up branch ~179–236).
- **Learning — webhook metadata must be data-driven:** `docs/solutions/logic-errors/stripe-webhook-metadata-missing-skips-cleanup.md` (KTD3).
- **Learning — SECURITY DEFINER grant hardening:** `docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md` (KTD7).
- **Vocabulary:** `CONCEPTS.md` (Ticket, Ticket Type, Registration, Top-up, Rate Class, Slot Status).
- **Data-model reference:** schema map from this session's exploration of `tickets`, `event_ticket_types`, `event_registrations`, `event_registration_items`.
