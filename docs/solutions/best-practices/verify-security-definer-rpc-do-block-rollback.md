---
title: "Verify a SECURITY DEFINER Postgres RPC with a rolled-back DO-block on the shared Supabase DB"
module: "supabase Postgres SECURITY DEFINER RPCs"
date: 2026-07-08
problem_type: best_practice
category: best-practices
component: testing_framework
severity: medium
applies_when:
  - "Verifying behavior of a SECURITY DEFINER Postgres RPC before shipping"
  - "Dev and prod share one Supabase database and additive migrations apply to prod immediately"
  - "No pgTAP or DB integration-test harness exists"
  - "The vitest suite mocks Supabase so route/webhook tests never exercise the real SQL"
  - "Applying migrations and verifying through the Supabase MCP (apply_migration / execute_sql)"
related_components:
  - database
  - tooling
  - development_workflow
tags:
  - supabase
  - postgres
  - security-definer
  - rpc
  - do-block
  - rollback
  - verification
  - mcp
---

# Verify a SECURITY DEFINER Postgres RPC with a rolled-back DO-block on the shared Supabase DB

## Context

Every `SECURITY DEFINER` Postgres RPC in this repo (`fill_ticket`, `mint_registration_tickets`, `apply_registration_topup`, and now `apply_ticket_type_conversion`) carries the real transactional logic of the app — row locks, conditional line-item reconciliation, idempotent replay guards, multi-branch conflict handling. None of it runs in the test suite. Three constraints stack up:

- **Dev and prod share ONE Supabase database** (project `rmchkoktpzoojlglyfca`). Additive migrations apply to production the instant you run them. Any verification you do runs against live data.
- **There is no pgTAP or DB integration-test harness.** No fixture framework, no transactional-rollback test wrapper, no seeded test schema.
- **The vitest suite mocks Supabase entirely.** Route and webhook tests mock `@/lib/supabase/admin`, so the SQL body of an RPC is never executed — the tests assert that the TypeScript calls `rpc('apply_ticket_type_conversion', …)`, not that the function does the right thing.

So the natural instincts both fail. Writing a vitest test proves nothing about the SQL because the client is mocked. Writing a plain DB test (`INSERT` a fixture, call the RPC, `SELECT` the result) leaves orphaned rows in a shared production database. What's needed is real, DB-level proof of the RPC's every branch, executed against the actual schema and constraints, with **zero residue**.

## Guidance

Verify the RPC with a **single** `execute_sql` call wrapping an anonymous `DO $$ … $$` block that builds its own fixture inline, calls the RPC, asserts each branch, and then **deliberately raises an exception to force the whole transaction to roll back**. The raised message is what the MCP hands back to you, so a final `ALL_PASS` means every assertion held; any earlier `FAIL` message names the branch that broke.

Why one call, and why an exception? The Supabase MCP `execute_sql` autocommits each call — you cannot hold a `BEGIN` open in call A and `ROLLBACK` in call B. But **inside** one call you have a single implicit transaction, and a `DO` block runs entirely within it. Raise an unhandled exception anywhere in that block and Postgres rolls back everything the block wrote — fixture graph, RPC mutations, all of it. The exception is the cleanest possible forced rollback, and it doubles as your result channel.

### The DO-block skeleton

```sql
DO $$
DECLARE
  v_event_type_id uuid := gen_random_uuid();
  v_event_id      uuid := gen_random_uuid();
  v_from_type_id  uuid := gen_random_uuid();
  v_to_type_id    uuid := gen_random_uuid();
  v_reg_id        uuid := gen_random_uuid();
  v_ticket_id     uuid := gen_random_uuid();
  v_conv_id       uuid := gen_random_uuid();
  v_result        jsonb;
  v_qty           integer;
BEGIN
  -- 1. Build a complete fixture graph inline. Every FK parent must exist:
  --    event_types (FK parent of events), the event, both ticket types,
  --    the registration, its line items, and the ticket(s).
  INSERT INTO public.event_types (id, /* … */) VALUES (v_event_type_id, /* … */);
  INSERT INTO public.events (id, event_type_id, /* … */)
    VALUES (v_event_id, v_event_type_id, /* … */);
  INSERT INTO public.event_ticket_types (id, event_id, title, /* price cols */)
    VALUES (v_from_type_id, v_event_id, 'Standard', /* … */),
           (v_to_type_id,   v_event_id, 'VIP',      /* … */);
  INSERT INTO public.event_registrations (id, /* … */) VALUES (v_reg_id, /* … */);
  INSERT INTO public.event_registration_items
    (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
    VALUES (v_reg_id, v_from_type_id, 'Standard', 1, 100, 100);
  -- GOTCHA: tickets_claimed_named requires `name IS NOT NULL` when slot_status = 'claimed'.
  INSERT INTO public.tickets
    (id, registration_id, ticket_type_id, slot_status, name /* required for 'claimed' */, credential_token)
    VALUES (v_ticket_id, v_reg_id, v_from_type_id, 'claimed', 'Test Person', 'CRED_X');
  INSERT INTO public.event_ticket_type_conversions
    (id, registration_id, ticket_id, from_type_id, to_type_id, from_unit_chf, to_unit_chf, delta_chf)
    VALUES (v_conv_id, v_reg_id, v_ticket_id, v_from_type_id, v_to_type_id, 100, 250, 150);

  -- 2. HAPPY PATH: call the RPC and assert the branch it should have taken.
  v_result := public.apply_ticket_type_conversion(v_conv_id);
  IF v_result->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'S1 FAIL: expected applied, got %', v_result;
  END IF;
  IF (SELECT ticket_type_id FROM public.tickets WHERE id = v_ticket_id) <> v_to_type_id THEN
    RAISE EXCEPTION 'S1 FAIL: ticket type not swapped';
  END IF;

  -- 3. IDEMPOTENT REPLAY: second call must be a no-op returning 'already'.
  v_result := public.apply_ticket_type_conversion(v_conv_id);
  IF v_result->>'status' <> 'already' THEN
    RAISE EXCEPTION 'S2 FAIL: replay not idempotent, got %', v_result;
  END IF;

  -- 4. … further branches (conflict cases, not_found, no-line defensive branch,
  --    post-op mint no-op invariant) each with their own Sx FAIL guard …

  -- 5. Force rollback. Reaching here means every assertion above passed.
  RAISE EXCEPTION 'ALL_PASS';
END $$;
```

You'll see the MCP return the error `ALL_PASS` (or an `Sx FAIL: …` if a branch broke). That error IS the pass signal, and because it's an exception, nothing you inserted or the RPC wrote survives — the shared DB is untouched. (Confirm afterward with a cheap read, e.g. `SELECT count(*) FROM public.event_ticket_type_conversions` and a check for leaked fixture rows.)

### Grants check — separate, read-only

Grant hardening is a static property of the function, not a runtime branch, so verify it with a plain read-only query (no `DO` block, nothing to roll back). On Supabase, `REVOKE … FROM PUBLIC` alone leaves a `SECURITY DEFINER` function anon-callable — you must also revoke from `anon` and `authenticated`. Assert that directly:

```sql
SELECT
  has_function_privilege('anon',          'public.apply_ticket_type_conversion(uuid)', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'public.apply_ticket_type_conversion(uuid)', 'EXECUTE') AS auth_exec,
  has_function_privilege('service_role',  'public.apply_ticket_type_conversion(uuid)', 'EXECUTE') AS svc_exec;
```

`anon_exec` and `auth_exec` must be `false`; `svc_exec` must be `true`. (This is the same gotcha captured in [`supabase-securitydefiner-anon-execute-grant-2026-06-04.md`](../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md).)

## Why This Matters

- **Transactional isolation on a shared prod DB with zero residue.** The `RAISE EXCEPTION 'ALL_PASS'` rollback means you can exercise destructive, multi-row, multi-branch SQL against the live production database and leave nothing behind — no cleanup script to forget, no orphaned test rows for someone to trip over later.
- **Real proof that mocked unit tests cannot give.** Because vitest mocks Supabase, the SQL body is dead weight to the test suite. This is the only way the row locks, the `pending→applied` flip, the line-item reconciliation, and the conflict guards are ever actually run against the real schema and its constraints.
- **Pinpointed failure messages.** Each branch guards with its own `Sx FAIL: …`. When something breaks you get the exact branch and the offending value back through the MCP, not a generic assertion failure — you know immediately which of happy-path / replay / conflict / not-found / no-line went wrong.

## When to Apply

- Whenever you add or change a `SECURITY DEFINER` or otherwise data-mutating Postgres RPC in this repo and need to verify it against the shared Supabase DB: `fill_ticket`, `mint_registration_tickets`, `apply_registration_topup`, `apply_ticket_type_conversion`, and any future siblings. Cover **every** branch in the one block — happy path, decrement-vs-delete, idempotent replay, each conflict case, `not_found`, defensive fallbacks, and any cross-RPC invariant.
- Pair it with **additive-migration-first ordering.** Apply the additive migration (new table + `create or replace function` + idempotent grants) via the MCP `apply_migration` before (or atomically with) shipping the route/webhook/UI. Migration-before-code is safe on the shared DB — the new table and function sit unused until the code lands; code-before-migration 500s. Verify the RPC with the `DO`-block immediately after applying the migration, before you deploy the calling code.

## Examples

**Abbreviated but real assertion — swap + line-item reconciliation + post-op mint no-op invariant** (from the `apply_ticket_type_conversion` verification). After the happy-path call, three things must all hold: the ticket type is swapped, the line items are reconciled quantity-preserving (the from-type line decremented/deleted, the to-type line incremented/inserted), and — critically — the dependent `mint_registration_tickets` RPC remains a **no-op**, because the whole point of reconciling line items was to keep `sum(line_item.quantity) == live ticket count per type` intact.

Note `mint_registration_tickets` `returns integer` (the count minted), so capture it in an `integer`, not a jsonb — add `v_minted integer;` to the `DECLARE` block:

```sql
  v_result := public.apply_ticket_type_conversion(v_conv_id);
  IF v_result->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'S1 FAIL: got %', v_result;
  END IF;

  -- from-type line decremented to 0 -> deleted; to-type line now exists at qty 1
  IF EXISTS (SELECT 1 FROM public.event_registration_items
             WHERE registration_id = v_reg_id AND ticket_type_id = v_from_type_id) THEN
    RAISE EXCEPTION 'S1 FAIL: from-type line not removed';
  END IF;
  SELECT quantity INTO v_qty FROM public.event_registration_items
    WHERE registration_id = v_reg_id AND ticket_type_id = v_to_type_id;
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'S1 FAIL: to-type qty = %, expected 1', v_qty;
  END IF;

  -- INVARIANT: after reconciliation, minting must mint nothing.
  v_minted := public.mint_registration_tickets(v_reg_id);
  IF v_minted <> 0 THEN
    RAISE EXCEPTION 'S1 FAIL: mint was not a no-op, minted %', v_minted;
  END IF;
```

**Two fixture gotchas hit in practice:**

1. **The `tickets_claimed_named` check constraint** — `check (slot_status in ('unclaimed', 'issued') or name is not null)`. A ticket with `slot_status = 'claimed'` must carry a `name` — insert one without it and the fixture `INSERT` itself fails before the RPC is ever called. Give claimed tickets a `name` value in the fixture (an `issued` row may be nameless).
2. **A valid `event_types` FK parent.** The fixture `events` row references `event_types(id)`, so you must insert an `event_types` parent first (or select an existing id). Skipping straight to `events` yields a foreign-key violation, not a test result. Build the graph top-down: `event_types -> events -> event_ticket_types -> event_registrations -> event_registration_items / tickets -> conversion row`.

## Related learnings

- [`security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md`](../security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md) — the anon-execute grant gotcha this doc's grants check enforces (`REVOKE ALL … FROM PUBLIC, anon, authenticated`). Distinct concern (the grant fix vs the verification technique); use them together.
- [`architecture-patterns/live-table-rename-on-shared-prod-db.md`](../architecture-patterns/live-table-rename-on-shared-prod-db.md) — companion pattern for operating safely on the shared dev/prod Supabase DB (additive/idempotent migrations via the MCP).
- [`database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md`](../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md) — the seat-count RPC and capacity invariant that the post-op mint no-op check belongs to.
