---
title: "Don't reuse a column that's force-null for a row category as a value source"
date: "2026-05-26"
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
---

# Don't reuse a column that's force-null for a row category as a value source

## Context

The `events` table makes `price_non_member` **structurally null for members-only events**, by deliberate design enforced at every layer:

- **DB constraint** (`supabase/migrations/20260508120000_events_price_constraint_visibility.sql`) requires only `price_member` for members-only rows — `price_non_member` is explicitly allowed null:
  ```sql
  registration_enabled = false
  OR (
    price_member IS NOT NULL
    AND ( visibility = 'members_only' OR price_non_member IS NOT NULL )
  )
  ```
- **Write routes force it null on every edit** (`app/api/admin/events/create/route.ts`, `app/api/admin/events/update/route.ts`):
  ```ts
  const isMembersOnly = visibility !== "public";
  const effectivePriceNonMember = isMembersOnly ? null : priceNonMember;
  // ...persisted as price_non_member: effectivePriceNonMember
  ```
- **The agent route does the same** (`app/api/agent/events/[id]/route.ts`), and **the admin UI hides/clears the input** for members_only (`components/admin/EventManager.tsx`).

The trap: the private-invite-link feature (PR #32) planned to **reuse `price_non_member` as the flat guest price** for invited registrants on members-only events. But the register API computes amounts with `Number(...)`, and `Number(null) === 0` — so every invited guest would have registered **FREE**. A silent correctness/financial bug, not a crash. It was caught only at code/doc review (four reviewers independently converged on it), not in the brainstorm or the plan.

## Guidance

Before reusing an existing column to carry a new meaning, **verify the column is actually populated for the specific row category your feature targets.** A column that is non-null in general can be force-null for one category by constraint, write-path coercion, or UI gating — and `Number(null) === 0` (and `null ?? 0`) turns that absence into a silent, plausible-looking zero rather than an error.

When a row category cannot carry the existing column by design, **add a dedicated column** rather than overloading the one that's null there. The resolution here was `events.invite_price` (`supabase/migrations/20260526120000_events_invite_link.sql`), kept separate from `price_non_member`:

- Pricing is decided by session, never by the form email/code. Logged-out invitee → `invite_price`; logged-in active member → `price_member`.
- The register API **guards the null case explicitly** instead of trusting arithmetic (`app/api/events/[id]/register/route.ts`):
  ```ts
  const unitAmount = isMember
    ? Number(event.price_member)
    : isMembersOnly
      ? Number(event.invite_price)   // dedicated guest price, NOT price_non_member
      : Number(event.price_non_member);

  // Number(null) === 0, so an unset invite_price must be caught explicitly here
  if (
    (isMembersOnly && !isMember && event.invite_price === null) ||
    !Number.isFinite(unitAmount) ||
    unitAmount < 0
  ) {
    return bad("Event pricing is misconfigured", 500); // loud, not silently free
  }
  ```

Secondary rule: **the display path and the action/charge path must agree on what "missing" means.** They read the price independently, so a value in a valid-but-incomplete intermediate state (a valid invite code but no `invite_price` yet) must be interpreted the same way on both sides — otherwise the page shows one thing and the API does another.

## Why This Matters

This is a silent financial-correctness bug, not a crash. With `price_non_member` reused, every invited guest on a members-only event would have registered for CHF 0 — no error, no log, a real (free) confirmed registration. Bugs like this survive testing because the happy path "works"; only the convergence of four reviewers caught it before ship, while planning and the brainstorm both missed it. A dedicated column plus an explicit null guard converts the silent zero into a loud, visible misconfiguration (HTTP 500 "Event pricing is misconfigured").

A related operational reason to add a *new* column rather than start populating an existing force-null one: the existing column's null state is load-bearing elsewhere (constraint, routes, UI). Repurposing it would mean unwinding all of that; a dedicated column leaves those invariants intact.

## When to Apply

- Building any feature on the events pricing model (guest pricing, discounts, invite/comp flows, alternate price tiers).
- More generally: any time you plan to **reuse a nullable column** that is forced-null (by CHECK constraint, write-path coercion, or UI) for some subset of rows — especially when the consumer applies `Number(x)` or `x ?? 0`, where null silently becomes 0.
- Whenever a value can sit in a valid-but-incomplete intermediate state and is read by more than one code path (render vs submit).

## Examples

**Wrong — reusing the structurally-null column (the planned approach):**
```ts
// Members-only invited guest. price_non_member is ALWAYS null for these rows.
const unitAmount = isMember ? Number(event.price_member) : Number(event.price_non_member);
// Number(null) === 0  ->  every invited guest registers FREE, silently.
```

**Right — dedicated column + explicit null guard** (`app/api/events/[id]/register/route.ts`): see the Guidance snippet above.

**Display/charge agreement — "Free" vs "not open yet"** (`app/(public)/public/events/[id]/page.tsx`). The page initially rendered `Number(event.invite_price ?? 0)` → "Free" with a working Register button, while the API 500'd on submit. Fixed by treating a null `invite_price` on the invite path as "not open yet," matching the API's misconfig guard:
```ts
// A valid invite only unlocks registration once a guest price is set, so don't
// advertise a free-looking form the POST will refuse — show "not open yet".
const inviteRegisterable = hasValidInvite && event.invite_price !== null;
const showForm = !isMembersOnly || isActiveMember || inviteRegisterable;
```

**Type-regen footgun (auto memory [claude]):** when adding the columns to `types/database.ts`, they were hand-edited rather than regenerated, because the Supabase type generator drops the hand-written `MemberStatus` / `PaymentCaptureStatus` aliases at the end of the file. If you do regenerate, re-append those aliases.

## Related

- [single-writer-field-ownership-across-routes.md](../architecture-patterns/single-writer-field-ownership-across-routes.md) — sibling events-pricing learning. `invite_code`/`invite_price` follow the single-writer rule established there (the bulk update + settings routes must not write them), but the failure mode is distinct: that doc is about a bulk route silently *wiping* a field; this one is about *reusing* a force-null field that silently reads as 0. `invite_code`/`invite_price` are the latest real-world instance of that single-writer pattern.
- [partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md](../database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md) — the invite migration adds a partial unique index on `events.invite_code`; same indexing-hazard family for event tables.
- [stripe-supabase-payment-flow-integration-issues.md](../integration-issues/stripe-supabase-payment-flow-integration-issues.md) — sibling "silent failure in the payment path" learning; `Number(null)=0 → free registration` is the same genre.
- Source PRs: **#32** (feature + the "dedicated `invite_price` rather than reusing `price_non_member`" decision and rationale), **#33** (e2e pricing-matrix coverage, including the `invite_price`-unset → "not open yet" branch).
