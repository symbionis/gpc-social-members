---
title: "Don't reuse a column that's force-null for a row category as a value source"
date: "2026-05-26"
last_refreshed: "2026-05-26"
last_updated: "2026-07-09"
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
  - "Adding a new code path (top-up, admin add-tickets, import, manage page) or display projection that re-resolves event ticket pricing"
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

The durable fix is a **single shared price resolver** used by register, top-up, and any admin "add tickets"/import path, so a new consumer can't ship a subset of the logic again. It was never extracted — see the next section for what that cost. Persisting the rate class (or resolved unit/invite price) on the registration row at booking time would remove the `is_member`-is-lossy ambiguity at the source.

### The display projection — same trap, silent failure (PR #68)

The shared resolver was never extracted, so the trap recurred in a third consumer — this time on the **read/display side**, which is worse, because the display path has no loud null guard to catch it.

The booking page's `buyableTypes` projection (`app/(checkin)/public/bookings/[token]/page.tsx`) priced each type with the same two-way branch, then **filtered out** the types that priced to null:

```ts
// buyableTypes, before — two-way branch, then drop the nulls
const unit = registration.is_member ? t.price_member : t.price_non_member;
const amount = unit === null ? null : Number(unit);
// priceLabel becomes "—" when amount is null
// ...
.filter((t) => t.priceLabel !== "—");   // on an invite-only event: drops EVERY type
```

On an invite-only event every type has `price_non_member = NULL`, so for a non-member lead all types were dropped, `buyableTypes` came back `[]`, and `components/public/BookingManager.tsx:131` gates the panel behind `topupEndpoint && buyableTypes && buyableTypes.length > 0`. The whole "Buy more tickets" panel vanished. **No error, no log, no empty state, HTTP 200** — the affordance simply ceased to exist for exactly the guests an invite-only event is built for.

Contrast with PR #50: on the *charge* path the missing invite class hit the register route's explicit null guard and produced a loud `500 "Event pricing is misconfigured"`. On the *display* path there is no guard — a filter drops the row and the UI silently loses a feature. **The secondary rule above ("the display path and the action/charge path must agree on what missing means") is precisely what was violated**: the top-up route (`app/api/public/bookings/[token]/topup/route.ts:86`) and the sibling `convertTypes` projection twenty lines below in the same page file (line 138) both applied `price_non_member ?? invite_price`; only `buyableTypes` did not. The server was willing to sell; the page never offered. The user-visible signature was "I can change a ticket's type but I can't buy another one."

Three things let this ship, and each is a reusable warning:

1. **The plan flagged it and the implementation skipped it.** `docs/plans/2026-07-08-001-feat-convert-ticket-type-plan.md` says outright: *"note the current `buyableTypes` uses `is_member ? price_member : price_non_member` and does **not** fall back to `invite_price`; use the same fallback as the route"*, and its risk section states *"U4 explicitly fixes this."* U4 shipped the fallback in `convertTypes` and left `buyableTypes` untouched. A defect named in the plan is not a defect fixed by the plan.
2. **A comment declared the divergence deliberate.** The pre-fix comment on `convertTypes` read *"buyableTypes above deliberately does NOT fall back."* The bug survived audits because it was documented as a feature. A comment asserting an intentional divergence between two adjacent code paths deserves a test or a shared helper — never trust.
3. **Verifying against rendered HTML gives a false negative.** `BuyMorePanel` is collapsed by default, so its type list never appears in the initial server-rendered HTML even when working. `grep "CHF 80" page.html` returns nothing in both the broken and the fixed state. The server-computed props live in the **RSC flight payload**; assert on that (or expand the panel in a browser test), not on the DOM markup.

The fix (PR #68) is the same coalesce, applied to the projection:

```ts
// buyableTypes, after — identical to convertTypes and the top-up route
const unit = registration.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
```

Accepted trade-off: where an invite type is zero-priced, an invited non-member can now add free tickets. This is correct by definition (`invite_price` *is* the guest's rate) and remains bounded — the top-up route enforces the event seat cap (`app/api/public/bookings/[token]/topup/route.ts`).

**The prevention rule, sharpened by a second recurrence:** stop writing the branch. As of this writing, **six sites re-derive the rate → unit price**, and no shared resolver exists. Four hand-roll the identical coalesce — `buyableTypes` and `convertTypes` in the booking page, the top-up route, and the convert route (`app/api/public/bookings/[token]/convert/route.ts`) — while two more spell out a parallel three-way switch: the register route and the public event page (`app/(public)/public/events/[id]/page.tsx`). Every new consumer is a fresh chance to omit the fallback, and it has been omitted twice (#50, #68). Extract `unitPriceFor(ticketType, { isMember })` returning `isMember ? price_member : (price_non_member ?? invite_price)`, have all of them call it, and a seventh consumer cannot ship a subset of the logic.

Additionally, **a filter that can drop every row must not silently remove the affordance** — collapse-to-empty should render an empty state ("No additional tickets available") or log, so "the panel is gone" is distinguishable from "the panel was never wired up." A regression fixture pins it: an invite-only event with four types (`price_non_member = NULL`, `invite_price` set) must yield `buyableTypes.length === 4` for a non-member lead.

## Why This Matters

This is a silent financial-correctness bug, not a crash. With `price_non_member` reused, every invited guest on a members-only event would have registered for CHF 0 — no error, no log, a real (free) confirmed registration. Bugs like this survive testing because the happy path "works"; only the convergence of four reviewers caught it before ship, while planning and the brainstorm both missed it. A dedicated column plus an explicit null guard converts the silent zero into a loud, visible misconfiguration (HTTP 500 "Event pricing is misconfigured").

A related operational reason to add a *new* column rather than start populating an existing force-null one: the existing column's null state is load-bearing elsewhere (constraint, routes, UI). Repurposing it would mean unwinding all of that; a dedicated column leaves those invariants intact.

## When to Apply

- Building any feature on the events pricing model (guest pricing, discounts, invite/comp flows, alternate price tiers).
- Adding or reviewing any *additional* consumer of event pricing (top-up, admin add-tickets, import, manage page) — it must resolve the same 3-class rate as the register route, or invited guests on members-only events break (PR #50).
- Adding or reviewing a **display-side projection** that maps ticket types to prices and then filters, sorts, or gates UI on the result (PR #68). Read paths have no null guard: where the charge path 500s loudly, the display path drops the row and the feature silently disappears.
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

**Recurrence — the same trap in a third consumer, this time a display projection (PR #68)** (`app/(checkin)/public/bookings/[token]/page.tsx`):
```ts
// Wrong — two-way branch, then filter out the nulls it just created
const unit = registration.is_member ? t.price_member : t.price_non_member;
// → every type prices to "—" on an invite-only event → .filter(...) drops all of them
//   → buyableTypes = [] → BookingManager gates the panel away → button silently absent

// Right (PR #68) — the same coalesce the route and convertTypes already used
const unit = registration.is_member ? t.price_member : (t.price_non_member ?? t.invite_price);
```
There is no null guard on a read path, so this failed **silently** (HTTP 200, no log) rather than loudly. Same root cause, strictly worse observability — which is the argument for the shared resolver rather than a fourth hand-rolled branch.

**Type-regen footgun (auto memory [claude]):** when adding the columns to `types/database.ts`, they were hand-edited rather than regenerated, because the Supabase type generator drops the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases at the end of the file. If you do regenerate, re-append those aliases.

## Related

- [single-writer-field-ownership-across-routes.md](../architecture-patterns/single-writer-field-ownership-across-routes.md) — sibling events-pricing learning. `invite_price` follows the single-writer rule established there; PR #35 moved it to a per-type column and added that doc's "Shape B" carry-through case (the shared ticket-type editor must echo the guest price, not null it). The failure mode here is distinct: that doc is about *wiping* a field; this one is about *reusing* a force-null field that silently reads as 0.
- [partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md](../database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md) — the invite migration adds a partial unique index on `events.invite_code`; same indexing-hazard family for event tables.
- [stripe-supabase-payment-flow-integration-issues.md](../integration-issues/stripe-supabase-payment-flow-integration-issues.md) — sibling "silent failure in the payment path" learning; `Number(null)=0 → free registration` is the same genre.
- [guard-shared-content-as-entity-specific-2026-05-21.md](../design-patterns/guard-shared-content-as-entity-specific-2026-05-21.md) — shares the prevention rule that a stale in-code comment is an assumption, not a spec. PR #68 survived audits because a comment asserted the divergence was deliberate.
- Source PRs: **#32** (feature + the "dedicated `invite_price` rather than reusing `price_non_member`" decision and rationale), **#33** (e2e pricing-matrix coverage, including the `invite_price`-unset → "not open yet" branch), **#35** (moved `invite_price` to the per-type `event_ticket_types` model; the register/display snippets above reflect per-type resolution, and the events-table price constraint was dropped in `20260526133000`), **#50** (the same trap recurred in the booking top-up route `app/api/public/bookings/[token]/topup/route.ts` — the missed sibling consumer; fixed with a `price_non_member ?? invite_price` fallback), **#58** (convert-ticket-type; its plan named the `buyableTypes` gap and claimed U4 would fix it, but U4 fixed only `convertTypes`), **#68** (third recurrence — the `buyableTypes` display projection; silent panel disappearance for invited non-member leads).
- **PR #67** (same file, same session as #68, different species of the same instinct): `BookingManager.tsx` suppressed a ticket's guest name whenever the ticket had been forwarded (`{!ticket.forwarded && ...}`), so a lead with 20 tickets saw 9 of them nameless and reported "not all my guests are showing" — the names were in the database the whole time. Also defended by a confident comment ("Once forwarded the ticket is handed over — no name/validity line here"). Two bugs in one file in one session, both a UI conditional hiding state the backend actually had, each rationalized in prose. When a page "loses" data or an affordance, suspect the projection before the store.
