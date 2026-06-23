---
title: "Don't reuse a column that's force-null for a row category as a value source"
date: "2026-05-26"
last_refreshed: "2026-05-26"
last_updated: "2026-06-23"
category: "architecture-patterns"
module: "events"
problem_type: "architecture_pattern"
component: "database"
severity: "high"
applies_when:
  - "Reusing an existing nullable column as a value source for a new feature"
  - "A column is deliberately forced-null for a category of rows by a CHECK constraint, write-path coercion, or UI gating"
  - "Numeric coercion is applied to a possibly-null value (Number(null) becomes 0)"
  - "Planning a guest/comp/alternate-price feature against members_only events"
  - "Adding a new code path (top-up, admin add-tickets, import, manage page) that re-resolves event ticket pricing"
related_components:
  - "payments"
  - "tooling"
tags:
  - "events"
  - "pricing"
  - "nullable-column"
  - "schema-invariant"
  - "check-constraint"
  - "silent-bug"
  - "single-writer"
  - "topup"
---

# Don't reuse a column that's force-null for a row category as a value source

## Context

The events pricing model makes `price_non_member` **structurally null for members-only events** by deliberate design — originally on the `events` table, now per ticket type on `event_ticket_types` (PR #35). The force-null is enforced at every layer:

- **Server-side write coercion** (`lib/events/ticket-types.ts`, `normalizeTicketType` — the single per-type writer) force-nulls the irrelevant column when persisting a ticket type: members-only types never carry `price_non_member`, public types never carry `invite_price`:
  ```ts
  // normalizeTicketType
  price_non_member: isMembersOnly ? null : pnm.value,
  invite_price:     isMembersOnly ? inv.value : null,
  ```
- **The admin UI hides/clears the input** for the irrelevant visibility (`components/admin/EventManager.tsx` → `TicketTypesEditor`), and the agent route persists through the same per-type writer.
- **Historical note:** before the per-type model, an `events`-table CHECK constraint (`events_prices_required_when_registration_enabled`, relaxed for members-only in `20260508120000_events_price_constraint_visibility.sql`) enforced this. That constraint was **dropped** in `20260526133000_drop_events_price_constraint.sql` once prices moved to `event_ticket_types`; the per-type equivalent now lives in `normalizeTicketType` + `assertEventRegistrationPriceable`.

The trap: the private-invite-link feature (PR #32) planned to **reuse `price_non_member` as the flat guest price** for invited registrants on members-only events. But the register API computes amounts with `Number(...)`, and `Number(null) === 0` — so every invited guest would have registered **FREE**. A silent correctness/financial bug, not a crash. It was caught only at code/doc review (four reviewers independently converged on it), not in the brainstorm or the plan.

## Guidance

Before reusing an existing column to carry a new meaning, **verify the column is actually populated for the specific row category your feature targets.** A column that is non-null in general can be force-null for one category by constraint, write-path coercion, or UI gating — and `Number(null) === 0` (and `null ?? 0`) turns that absence into a silent, plausible-looking zero rather than an error.

When a row category cannot carry the existing column by design, **add a dedicated column** rather than overloading the one that's null there. The resolution was a dedicated `invite_price` — first as `events.invite_price` (`20260526120000_events_invite_link.sql`), then moved per ticket type to `event_ticket_types.invite_price` (`20260526130000_event_ticket_types.sql`) when the multi-ticket-type model landed — kept separate from `price_non_member`:

- Pricing is decided by session, never by the form email/code. Logged-out invitee → `invite_price`; logged-in active member → `price_member`; public non-member → `price_non_member`.
- The register API resolves the rate **per ticket type** and **guards the null case explicitly** instead of trusting arithmetic (`app/api/events/[id]/register/route.ts`):
  ```ts
  // per chosen ticket type (t), resolved by the registrant's rate class
  const unit =
    rateClass === "member"
      ? t.price_member
      : rateClass === "invite"
        ? t.invite_price        // dedicated guest price, NOT price_non_member
        : t.price_non_member;

  // Number(null) === 0, so an unset price must be caught explicitly here
  if (unit === null || !Number.isFinite(Number(unit)) || Number(unit) < 0) {
    return bad("Event pricing is misconfigured", 500); // loud, not silently free
  }
  ```

Secondary rule: **the display path and the action/charge path must agree on what "missing" means.** They read the price independently, so a value in a valid-but-incomplete intermediate state (a valid invite code but no `invite_price` yet) must be interpreted the same way on both sides — otherwise the page shows one thing and the API does another.

### Every booking path must resolve the same rate class — not just register (PR #50 recurrence)

The register API was fixed, but its rate-class resolution was **hand-rolled in that route, not extracted into a shared resolver**. So when the booking **top-up** path shipped (the "Buy more tickets" flow on the manage page), it re-implemented pricing as a **two-way** branch instead of register's **three-way** rate class (`app/api/public/bookings/[token]/topup/route.ts`):

```ts
// top-up, before — only two classes, no invite class
const unit = reg.is_member ? t.price_member : t.price_non_member;
```

On a members-only event `price_non_member` is structurally null, so every invited-guest top-up (`event_registrations.is_member = false`) resolved null and hit the loud guard — `500 "Event pricing is misconfigured"`. The guard did its job (no silent free top-up), but legitimate invited guests were **locked out of "Buy more tickets" entirely** — ~60 live bookings on the published "Season Open: Asado & Party" event (47 free + 13 paid). PR #50 fixed it with a coalesce fallback (and added `invite_price` to the route's `event_ticket_types` select):

```ts
// top-up, after — fall back to the dedicated guest column
const unit = reg.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
```

Why a coalesce here rather than register's explicit three-way switch? The registration row stores only the boolean `is_member`, never the resolved rate class — the class is derived at booking time from `event.visibility` + the invite code and then discarded. So the top-up path cannot distinguish "invited guest" from "public non-member"; `price_non_member ?? invite_price` reproduces the right rate without re-deriving it (public events keep `price_non_member`, which is set; members-only events fall through to `invite_price`). **Treat `is_member` as lossy** — a stored boolean cannot represent a 3-value rate class, so any code reading it to make a pricing decision is suspect.

The durable fix is a **single shared price resolver** used by register, top-up, and any admin "add tickets"/import path, so a new consumer can't ship a subset of the logic again. Persisting the rate class (or resolved unit/invite price) on the registration row at booking time would remove the `is_member`-is-lossy ambiguity at the source.

## Why This Matters

This is a silent financial-correctness bug, not a crash. With `price_non_member` reused, every invited guest on a members-only event would have registered for CHF 0 — no error, no log, a real (free) confirmed registration. Bugs like this survive testing because the happy path "works"; only the convergence of four reviewers caught it before ship, while planning and the brainstorm both missed it. A dedicated column plus an explicit null guard converts the silent zero into a loud, visible misconfiguration (HTTP 500 "Event pricing is misconfigured").

A related operational reason to add a *new* column rather than start populating an existing force-null one: the existing column's null state is load-bearing elsewhere (constraint, routes, UI). Repurposing it would mean unwinding all of that; a dedicated column leaves those invariants intact.

## When to Apply

- Building any feature on the events pricing model (guest pricing, discounts, invite/comp flows, alternate price tiers).
- Adding or reviewing any *additional* consumer of event pricing (top-up, admin add-tickets, import, manage page) — it must resolve the same 3-class rate as the register route, or invited guests on members-only events break (PR #50).
- More generally: any time you plan to **reuse a nullable column** that is forced-null (by CHECK constraint, write-path coercion, or UI) for some subset of rows — especially when the consumer applies `Number(x)` or `x ?? 0`, where null silently becomes 0.
- Whenever a value can sit in a valid-but-incomplete intermediate state and is read by more than one code path (render vs submit).

## Examples

**Wrong — reusing the structurally-null column (the planned approach):**
```ts
// Members-only invited guest. price_non_member is ALWAYS null for these rows.
const unitAmount = isMember ? Number(t.price_member) : Number(t.price_non_member);
// Number(null) === 0  ->  every invited guest registers FREE, silently.
```

**Right — dedicated column + explicit null guard** (`app/api/events/[id]/register/route.ts`): see the Guidance snippet above.

**Display/charge agreement — "Free" vs "not open yet"** (`app/(public)/public/events/[id]/page.tsx`). The page initially rendered a free-looking form (a null guest price coerced to `Number(... ?? 0)` → "Free") with a working Register button, while the API 500'd on submit. Fixed by treating a null resolved price on the invite path as "not open yet," matching the API's misconfig guard — now computed per ticket type:
```ts
// A valid invite only unlocks registration once a guest price is set, so don't
// advertise a free-looking form the POST will refuse — show "not open yet".
const inviteRegisterable = hasValidInvite && anyPriceable; // anyPriceable: some type has a non-null resolved price
const showForm = !isMembersOnly || isActiveMember || inviteRegisterable;
```

**Recurrence — the same trap in a second consumer (top-up)** (`app/api/public/bookings/[token]/topup/route.ts`):
```ts
// Wrong — two-way branch; price_non_member is null on members-only events
const unit = reg.is_member ? t.price_member : t.price_non_member;     // → 500 for invited guests

// Right (PR #50) — coalesce to the dedicated guest column
const unit = reg.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
```
The register route's explicit null guard was already present here, so the failure was **loud** (HTTP 500) rather than a silent free top-up — but the missing invite class still locked legitimate guests out until the fallback was added.

**Type-regen footgun (auto memory [claude]):** when adding the columns to `types/database.ts`, they were hand-edited rather than regenerated, because the Supabase type generator drops the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases at the end of the file. If you do regenerate, re-append those aliases.

## Related

- [single-writer-field-ownership-across-routes.md](../architecture-patterns/single-writer-field-ownership-across-routes.md) — sibling events-pricing learning. `invite_price` follows the single-writer rule established there; PR #35 moved it to a per-type column and added that doc's "Shape B" carry-through case (the shared ticket-type editor must echo the guest price, not null it). The failure mode here is distinct: that doc is about *wiping* a field; this one is about *reusing* a force-null field that silently reads as 0.
- [partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md](../database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md) — the invite migration adds a partial unique index on `events.invite_code`; same indexing-hazard family for event tables.
- [stripe-supabase-payment-flow-integration-issues.md](../integration-issues/stripe-supabase-payment-flow-integration-issues.md) — sibling "silent failure in the payment path" learning; `Number(null)=0 → free registration` is the same genre.
- Source PRs: **#32** (feature + the "dedicated `invite_price` rather than reusing `price_non_member`" decision and rationale), **#33** (e2e pricing-matrix coverage, including the `invite_price`-unset → "not open yet" branch), **#35** (moved `invite_price` to the per-type `event_ticket_types` model; the register/display snippets above reflect per-type resolution, and the events-table price constraint was dropped in `20260526133000`), **#50** (the same trap recurred in the booking top-up route `app/api/public/bookings/[token]/topup/route.ts` — the missed sibling consumer; fixed with a `price_non_member ?? invite_price` fallback).
