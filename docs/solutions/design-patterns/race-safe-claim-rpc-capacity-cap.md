---
title: "Race-safe slot-claim RPC: enforce a capacity cap at claim time"
date: 2026-06-07
last_updated: 2026-08-14
category: design-patterns
module: events
problem_type: design_pattern
component: database
severity: high
applies_when:
  - "Multiple unauthenticated actors race to claim limited slots against a shared capacity cap"
  - "A natural parent/owner row defines the cap and child rows consume it"
  - "Claims must serialize against a cap, whether they insert or flip a pre-provisioned row"
  - "The cap is hierarchical — a group total and/or a per-subtype sub-cap"
  - "A claim is idempotent across retries, but the same actor may legitimately claim more than one subtype"
  - "Capacity logic must live server-side because there is no trusted client (public link, no login)"
tags:
  - postgres
  - row-locking
  - select-for-update
  - concurrency
  - capacity-cap
  - security-definer
  - supabase-rpc
  - race-condition
related_components:
  - database
  - authentication
  - event-registration
---

# Race-safe slot-claim RPC: enforce a capacity cap at claim time

> **Update (2026-07-22):** The concrete example below — the self-registration flow, the `claim_self_registration` RPC, and the `event_registrations.self_reg_token` column/index — has been **retired** (self-registration removed in U16 / PR #88; the RPC, column, and unique index dropped in R28 / PR #92). The `event_attendees` table it references was **renamed to `tickets`**. The **pattern is unchanged and still in force**: the surviving `claim_ticket` RPC (checkout roster-fill + door walk-up) enforces the same race-safe, `SELECT … FOR UPDATE`-locked, no-pre-provisioning capacity cap on `tickets`, and event capacity is now also computed in SQL by `seats_used` (`purchased − cancelled`). Read the `claim_self_registration` / `event_attendees` / `self_reg_token` snippets below as the historical form of a pattern that today lives in `claim_ticket`.
>
> **Update (2026-08-14): this doc carried the subtype in the cap but not in the replay key, and that gap was a bug.** §5 models a per-subtype sub-cap; §3 described the idempotency key as name + contact. PR #132 had to add exactly the missing dimension after one person's two ticket types collapsed into a single unnamed seat. §3 is corrected below, but the rule the pattern needs stated once is this: **a replay/idempotency key must include every dimension that legitimately varies, and nothing that doesn't — and if you enforce a sub-cap per subtype, the subtype is by definition such a dimension.** A cap and a key that disagree about what makes two claims different will always resolve in favour of the key, silently.
>
> **Update (2026-08-11):** One design premise below did **not** survive, and the Context section should be read as the reasoning of its time. U3 (`supabase/migrations/20260622180000_mint_registration_tickets.sql`) now mints one `issued`, credentialled ticket per purchased slot at confirmation — that is exactly the "pre-provisioning" the Context marks *Rejected* — and `claim_ticket` flips an `issued` row to `claimed` rather than inserting, falling back to INSERT only when no open row exists. Crucially, **the hazard the rejection was premised on never materialised**: the per-type cap counts `slot_status = 'claimed'` only, so pre-provisioned rows never entered the `purchased − claimed` subtraction. What generalises from this doc is the lock-and-count concurrency pattern; the insert-vs-update choice is not part of it.

## Context

Event self-registration (PR #39) gives a paid party one shareable link
(`/public/registrations/<token>`) so the other people in the party add
themselves to the door roster — name + email-or-phone, optional self-signed
waiver — without staff data entry. The link must admit **at most N**
self-registrations, where N is the party's purchased `quantity`, later refined
to also cap **per ticket type** (a party that bought 1 "Without Asado" + 3
"Standard" must not let a fourth guest take a Standard, or anyone take a second
"Without Asado").

The hard part is concurrency: several guests open the same link and submit
within the same second. Two naive approaches fail:

1. **App-layer count-then-insert.** Read the claimed count, compare to the cap,
   insert if under. Classic TOCTOU race — two requests both read "3 of 4," both
   pass, both insert, party ends up with 5. The endpoint is also unauthenticated,
   so there is no logged-in user whose intent the server can lean on.
2. **Pre-provisioning N−1 placeholder rows** and having each guest *update* a
   reserved one. Rejected (documented in the header of
   `supabase/migrations/20260604120000_self_registration_token_and_claim.sql`):
   it would change the money-path registration RPC and the Stripe/confirmation
   seed, and leave orphan placeholder rows behind every abandoned checkout. The
   no-pre-provisioning choice is also load-bearing for the per-type cap, which
   computes remaining capacity as `purchased − claimed` — pre-provisioned rows
   would make that subtraction wrong. (session history: pre-provisioning was the
   assumed-away architecture from the start of the per-type work, not a late
   pivot.)

The shipped solution: **no pre-provisioned rows; a `SECURITY DEFINER` RPC locks
the parent registration row, counts under the lock, then inserts.**

## Guidance

A single plpgsql function, `claim_self_registration`, callable only by
`service_role`. The cap is made atomic not with an advisory lock, a unique
partial index, or a counted `INSERT ... WHERE`, but with a plain pessimistic
**`SELECT ... FOR UPDATE` on the parent registration row**.

**1. Lock the parent row first.** The first DB statement takes the row lock, so
every concurrent claim for the same link serializes behind it:

```sql
SELECT id, event_id, quantity, status
  INTO v_reg
FROM public.event_registrations
WHERE self_reg_token = p_token
FOR UPDATE;
```

The token is looked up via a partial unique index that only indexes non-null
tokens:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_self_reg_token_uniq
  ON public.event_registrations (self_reg_token)
  WHERE self_reg_token IS NOT NULL;
```

**2. Count and compare under the lock.** The cap check is a live `count(*)` of
claimed attendees evaluated while the lock is held, immediately followed by the
write. (As written in 2026-06 that write was always an INSERT, because nothing was
pre-provisioned; today `claim_ticket` flips a pre-minted `issued` row to `claimed`
and only INSERTs as a fallback. The lock-and-count half is what matters — the cap
counts `claimed` rows either way.)

```sql
SELECT count(*) INTO v_count
FROM public.event_attendees
WHERE registration_id = v_reg.id
  AND slot_status = 'claimed'
  AND released_at IS NULL;

IF v_count >= COALESCE(v_reg.quantity, 0) THEN
  RETURN jsonb_build_object('status', 'full');
END IF;
-- ... INSERT INTO event_attendees (...) VALUES (..., 'claimed', ...);
```

The lead/purchaser is itself a `claimed` attendee (seeded at registration), so
it counts toward the cap — N total people, lead included.

**3. Idempotency for double-submits — key it on every dimension that legitimately
varies, and nothing that doesn't.** Before counting, the function returns an existing
live attendee with the same **name + contact + subtype** (`already=true`) instead of
claiming a second slot — covers a double-tap or the lead re-using the link.

This key has been wrong in both directions, and both failures were silent. Too
*loose* (contact alone) collapsed two people sharing an email into one. Too *tight*
is the mirror image and far less obvious: **the subtype this pattern already models
in the cap (§5) must also be in the replay key.** Keying on name + contact while a
per-subtype sub-cap is in force silently forbids one person holding two slots of
different subtypes — the ordinary case for a multi-day event selling Friday and
Saturday separately. The second claim returned the first's row with `already=true`,
claimed nothing, reported success, and left a paid seat permanently unnamed.

The live key is scoped
(`supabase/migrations/20260814150000_claim_ticket_replay_guard_scoped_to_type.sql`):
`AND (v_ticket IS NULL OR ticket_type_id IS NULL OR ticket_type_id = v_ticket)`, with
two deliberate wide matches — an unresolved incoming type, and an untyped legacy row
that adopts the type on match and so must stay matchable. Narrowing costs no replay
safety: a genuine retry replays the same subtype too. See
[`../database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md`](../database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md).

**4. Why `SECURITY DEFINER` + service_role-only.** `event_attendees` and
`event_registrations` have RLS enabled **with no policies**, so anon/authenticated
are fully denied; only the service-role key can touch them. The cap logic must
therefore live in a definer function — there is no trusted client path. On
Supabase, `REVOKE ... FROM PUBLIC` alone is insufficient (default privileges
re-grant EXECUTE to anon/authenticated), so the grant is locked down explicitly.
See the companion learning
[`../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md`](../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md)
for that grant hygiene:

> **Read "have RLS enabled with no policies" as a property of these two tables, not a house invariant.** It held for them, but four other tables (`broadcast_recipients`, `event_reminder_sends`, `broadcasts`, `event_waitlist`) shipped with RLS *disabled* and were world-readable and world-writable via the anon key until 2026-08-09. Table access and function access are two independent gates, and this section only locks the second. See [`../security/supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md`](../security/supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md) for the table-side gate and the catalog queries that audit both.

```sql
REVOKE ALL ON FUNCTION public.claim_self_registration(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_self_registration(...) TO service_role;
```

**5. Per-ticket-type sub-cap (v2), under the same lock.** The total cap alone
would let a guest take a sub-type whose allotment is already exhausted. v2
(`20260604170000_claim_per_type_cap.sql`) adds a second check — still under the
already-held registration lock, so still race-safe — comparing claimed-of-type
against purchased-of-type and returning a new `type_full` status. Remaining is
computed as `purchased − claimed`, where **purchased** comes from
`event_registration_items` (the basket), never from attendee rows — guests who
have not yet self-registered have no attendee row, so counting attendee rows
would undercount:

```sql
IF v_ticket IS NOT NULL THEN
  SELECT COALESCE(sum(quantity), 0) INTO v_type_purchased
  FROM public.event_registration_items
  WHERE registration_id = v_reg.id AND ticket_type_id = v_ticket;

  SELECT count(*) INTO v_type_claimed
  FROM public.event_attendees
  WHERE registration_id = v_reg.id AND slot_status = 'claimed'
    AND released_at IS NULL AND ticket_type_id = v_ticket;

  IF v_type_claimed >= v_type_purchased THEN
    RETURN jsonb_build_object('status', 'type_full');
  END IF;
END IF;
```

**6. Two-layer enforcement.** The self-reg page filters the type selector to
only show types with `purchased − claimed > 0` (UI prevention); the RPC re-checks
the same arithmetic under the lock (race-safe enforcement). The UI cannot prevent
a true race for the last slot of a type; the RPC ensures only one claim wins and
the other gets `type_full` → HTTP 409 → the form shows a clear message and
reloads the available-type list. (session history: the v2 rewrite was triggered
by a live test — a 1-of-1 "Without Asado" type still appeared in the selector
after being consumed, because the page computed types from *purchased* items
without subtracting *claimed*.)

**7. The release / free-a-slot counterpart**
(`20260604140000_attendee_release_slot.sql`). Freeing a slot for a guest swap
**never deletes** the row — identity and signed waiver are kept for audit.
Instead a nullable `released_at` is set, and every live-count / idempotency /
matcher query gains `AND released_at IS NULL`. A freed slot reopens capacity
without losing the record.

> **Retired at the app layer (2026-08-11, PR #111).** `release_ticket` still
> exists in the database, `service_role`-only, but **nothing in the app calls it**
> — the roster's Remove button and `app/api/public/door/[id]/free-slot` were both
> retired. Freeing a *paid* seat is now a Cancellation, so the seat and its money
> are accounted for together; the only surviving release path is removing a comped
> guest from a guest list (`remove_comp_guest`). The `released_at` tombstone
> mechanics above are still exactly how that works — read this section as live
> machinery for comped seats and as the shape of the pattern, not as a route you
> can call. On why the RPC was kept rather than dropped, see
> [`../best-practices/retire-a-live-flow-drop-the-write-path-keep-the-history.md`](../best-practices/retire-a-live-flow-drop-the-write-path-keep-the-history.md).

## Why This Matters

Without the `FOR UPDATE` lock the count-then-insert is a TOCTOU race:
concurrent claims on a near-full party each read a count below the cap, each
pass, each insert — overselling the party (5 people on a 4-ticket booking; two
people on a 1-seat "Without Asado"). The lock forces every claim on a link to
serialize through the same registration row, so the second transaction re-reads
the count *after* the first has committed. The cap becomes a true invariant
rather than a hopeful check, and the per-type cap reuses the same already-held
lock instead of inventing a second locking scheme.

**Contrast — the door path *was* the counter-example, and has since been fixed.**
As originally written, `app/api/public/door/[id]/add-guest/route.ts` did the same
logical check — count claimed-and-unreleased, compare to `quantity`, insert — but
in application code via the admin client with **no row lock**: the very TOCTOU
this RPC exists to avoid. It was tolerated on operational grounds (a single door
volunteer adding one guest at a time, with explicit "over-capacity → welcome
desk" handling), with the note that it should be routed through the locked RPC if
it ever became concurrent.

That is what happened. `add-guest` no longer exists; the door now writes through
`app/api/public/door/[id]/save-attendee/route.ts`, which calls the locked
`claim_ticket` RPC rather than counting in application code. The unsafe path this
section contrasted against is gone — keep the contrast for the shape of the
mistake, not as a description of current code.

## When to Apply

Reach for this when **multiple unauthenticated (or weakly-authenticated) actors
race to claim slots against a shared, fixed capacity owned by a natural parent
row**, and especially when:

- there is no trusted client to do the check (public link, no login);
- the capacity is "N children of a parent," so a single parent row is a clean
  lock target;
- claiming should *insert* rather than update a reserved row (avoid mutating a
  payment path or leaving orphan placeholders);
- the cap is hierarchical — a group total and/or a per-subtype sub-cap — both
  enforceable under one parent lock.

If there were no single owning row to lock, you'd instead need an advisory lock
or a counted unique index.

## Pitfalls (learned the hard way)

- **`min()` has no `uuid` aggregate, and plpgsql doesn't validate the body at
  `CREATE`.** The auto-assign branch (fill in the sole purchased type when the
  caller passes none) first used `min(ticket_type_id)`. Postgres has no
  `min(uuid)`, but `CREATE OR REPLACE FUNCTION` compiles fine — the body is
  late-bound — so the broken branch shipped silently. (session history: it
  surfaced only when a **backfill script** ran the same `min(ticket_type_id)`
  and hit `ERROR: 42883: function min(uuid) does not exist`; every smoke test
  had passed an explicit type, so the null-ticket path was never exercised.) The
  fix (`20260604190000_fix_claim_autoassign.sql`) uses
  `(array_agg(DISTINCT ticket_type_id))[1]`. **Lesson: a function that compiles
  is not proof its body runs — exercise every branch, especially the
  defaulting/auto-assign ones.**
- **Count purchases from the basket, not from claimed rows.** With no
  pre-provisioned rows, `event_registration_items` is the only source of truth
  for what was bought; attendee rows only exist once claimed.
- **Vestigial `unclaimed` scaffolding.** `tickets.slot_status` still allows
  `'unclaimed'`, a legacy value predating per-ticket minting. The shipped flow
  mints `'issued'` and flips it to `'claimed'`, so no live path ever writes
  `'unclaimed'` — the branch is dead, and it is dead for a different reason than
  this doc originally gave (it was described as leftover from the *rejected*
  pre-provisioning model; pre-provisioning is what actually shipped).

## Examples

**The claim flow.** *(Historical — this route was removed with self-registration in PR #88; the surviving equivalent is `app/api/public/door/[id]/save-attendee/route.ts`, which maps `claim_ticket`'s statuses the same way.)* `app/api/public/registrations/[token]/claim/route.ts` was a
thin caller: validate input (name required; email-or-phone required; waiver
version sourced server-side, never trusted from the client; malformed
`ticketTypeId` dropped to `null`), call the RPC, map its jsonb status to HTTP —
`claimed → 200`, `full → 409`, `type_full → 409`, `inactive → 409`,
`invalid_input → 400`, `invalid → 404`.

**Before vs after the race.** Before: app reads `count = 3`, sees `3 < 4`,
inserts; a simultaneous request does the same → 5 attendees on a 4-ticket party.
After: both enter the RPC, both block on `SELECT ... FOR UPDATE` for that
registration; the first commits; the second's `count(*)` now returns 4, hits
`4 >= 4`, returns `{"status":"full"}` → 409. Cap held.

## Related

- [`../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md`](../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md)
  — the grant-hygiene companion (same RPC family); both are facets of the same
  service_role-only definer RPCs. Candidate for a future consolidation review of
  the PR #39 event-RPC docs.
- [`draft-row-claim-and-transition-2026-05-06.md`](draft-row-claim-and-transition-2026-05-06.md)
  — a different "claim" pattern despite the name: draft-row *lifecycle*
  (update-don't-insert), not a concurrency cap. Listed to disambiguate.
- [`../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md`](../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md)
  — argues capacity counting belongs in a definer RPC rather than app-side row
  fetches; this RPC is the realized form of that recommendation.
- [`../database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md`](../database-issues/partial-unique-index-stripe-webhook-23505-deadlock-2026-05-21.md)
  — adjacent race-safety on `event_registrations` via a different mechanism
  (partial unique index + 23505 handling).
- Source: PR #39 (`feat/event-guest-roster-m2`). Migrations
  `20260604120000_self_registration_token_and_claim.sql` (v1 locked claim),
  `20260604170000_claim_per_type_cap.sql` (per-type cap),
  `20260604190000_fix_claim_autoassign.sql` (`min(uuid)` fix),
  `20260604140000_attendee_release_slot.sql` (release).
