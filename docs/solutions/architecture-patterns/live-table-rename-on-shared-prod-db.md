---
title: "Renaming a live table on the shared dev/prod DB without downtime"
module: events
date: 2026-06-22
problem_type: architecture_pattern
component: database
severity: high
applies_when: "Renaming (or otherwise breaking-changing) a table that deployed code actively reads/writes, on a database where you cannot take downtime — especially a shared dev/prod Supabase instance with RLS and SECURITY DEFINER RPCs."
related_components:
  - service_object
  - background_job
  - payments
tags:
  - migration
  - table-rename
  - shared-database
  - security-invoker-view
  - supabase
  - deploy-ordering
  - backfill
  - mcp-apply-migration
  - feat-41
---

# Renaming a live table on the shared dev/prod DB without downtime

## Context

FEAT-41 renamed `event_attendees` → `tickets` and reshaped it (new `credential_token`
column, a third `slot_status` value, relaxed CHECK constraints). The catch: there is
**one shared Supabase instance for dev and prod**, the table is read/written on hot
paths (registration, Stripe webhook, door check-in), it is RLS-enabled with no
anon/authenticated policies (all access via the service-role admin client), and ~8
`SECURITY DEFINER` RPCs reference it. A naive `ALTER TABLE ... RENAME` would 500 every
request from the currently-deployed code the instant it ran, before the new code
deploys. This is the pattern that made the rename safe end-to-end.

## Guidance

Treat the rename as a **one-transaction cutover + a transitional bridge view**, deploy
it **gated** (migration applied close to the code deploy), then drop the bridge in a
follow-up.

**1. Do the whole cutover in a single transaction.** Rename, add columns, swap
constraints, `CREATE OR REPLACE` every dependent RPC onto the new name, create the
bridge view, and backfill — all inside `begin; … commit;`. A mid-migration failure
rolls back cleanly; the live table is never left half-renamed.

**2. Bridge old code with a `security_invoker` view of the OLD name.** After renaming
`event_attendees → tickets`, create a view named `event_attendees` over `tickets`. The
currently-deployed code calls `.from("event_attendees")` and keeps working — the view
is auto-updatable, so its INSERT/UPDATE/DELETE pass through to `tickets`.

```sql
-- security_invoker = true is load-bearing: without it the view runs as its OWNER and
-- BYPASSES the base table's RLS, leaking rows to anon/authenticated. With it, the view
-- respects the caller's RLS (service_role still bypasses as before).
create view public.event_attendees with (security_invoker = true) as
  select * from public.tickets;
grant select, insert, update, delete on public.event_attendees to service_role;
```

**3. Repoint the RPCs onto the new name directly** (don't lean on the view) so the view
can later be dropped without breaking them. `CREATE OR REPLACE` each `SECURITY DEFINER`
function with `public.tickets`. Confirm the real set by introspecting the *live* schema
(`pg_proc.prosrc ILIKE '%event_attendees%'`) — the migration files lagged the actual
function bodies (some were redefined via MCP earlier).

**4. Backfill additively, scoped to in-flight data.** New columns/state get backfilled
in the same transaction, scoped to events that haven't ended
(`coalesce(end_date, start_date) >= current_date`) so you don't churn historical rows.

**5. Deploy order is the safety property** (the migration header must state it):

1. Apply the migration to prod (the bridge view keeps the *old* deployed code working).
2. Merge + deploy the new code (it uses `tickets` + the new RPCs directly).
3. Drop the transitional view in a **follow-up** migration, once the new build is
   confirmed healthy.

Because the new code references the renamed table, the migration **must** land before
(or atomically with) the code deploy — the bridge view does not help the *new* code, it
helps the *old* code survive the gap. Keep step 1→2 short.

## Why This Matters

- **A rename preserves row identity (same UUIDs, same FKs, same indexes) — a "new
  table + copy" does not.** On a DB with *live writes*, copying forces dual-write or a
  divergence window for in-flight rows. The rename + bridge view avoids all of it: the
  existing rows stay put, only additive rows are inserted. (See
  `reusing-nullable-column-as-value-source-trap.md` for the inverse caution.)
- **The gap window is real but bounded.** During step 1→2 the *old* code runs against
  the migrated DB. It works via the view, but it won't run any *new* write logic — e.g.
  it won't mint the new `credential_token` for brand-new rows. Every *existing* in-flight
  row is handled by the backfill; only rows created in the gap need reconciling. Keep the
  window short, or run a post-deploy idempotent reconcile.
- **`security_invoker` is the difference between a bridge and a data leak.** A default
  (`security_invoker = false`) view executes as its owner and silently bypasses the base
  table's RLS. On an RLS-enabled table with no anon policy, that would expose every row
  to anon/authenticated through the view.

## When to Apply

- Renaming / breaking-changing any table that deployed code touches, where downtime
  isn't acceptable — most acutely on a **shared dev/prod** instance.
- Any Supabase/Postgres migration that must coexist with un-redeployed application code
  for a window (the bridge-view technique generalizes to column splits, type changes via
  a view-computed column, etc.).

## Examples

### Applying via the Supabase MCP — reconcile the migration ledger

These migrations were applied to prod with `mcp__supabase__apply_migration`, which
records its **own** timestamp version + the `name` you pass — **not** the committed
file's `NNN_name.sql` prefix. Left alone, a later `supabase db push` sees the file
version as "unapplied", tries to re-run it, and fails on the already-done rename.
Reconcile the ledger so the version matches the filename:

```sql
update supabase_migrations.schema_migrations
  set version = '20260622170000' where name = 'rename_attendees_to_tickets';
-- …one per applied migration, matching each committed filename prefix.
```

(Local validation used a different path entirely: the repo's `supabase/migrations/`
is **not** a from-scratch chain — early tables like `events`/`members` predate the
tracked files — so a local replica was seeded with `supabase db dump --linked` as a
baseline, then the feature migrations applied on top via `psql`.)

### A model invariant introduced by a rename must be enforced at EVERY write site

The rename added "every ticket carries a `credential_token` (QR)." The backfill set it
for existing rows, and most write paths were updated to maintain it — but **three insert
sites were missed** and silently produced credential-less rows:

- `seed_lead_attendee` (the buyer's own ticket) — shipped to prod and only caught when
  the lead's QR was visibly absent on the booking page.
- `import_event_attendees` (admin bulk import).
- An orphaned `add-guest` route still doing insert-on-claim (deleted).

A new column-level invariant is only as strong as the *weakest* writer. When a
migration introduces one, grep every `INSERT INTO <table>` (RPCs included, not just
app code) and confirm each either sets the new field or is intentionally exempt. The
backfill fixes the past; it does nothing for the next insert.

```sql
-- the fix at each insert site:
credential_token =
  replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_')
```

### Verify the cutover with SQL, not vibes

Run read-only pre-checks (table exists, new column absent, `slot_status` only holds
expected values, RPC count) before applying, and post-checks after: claimed-row count
unchanged, zero null credentials on in-flight rows, credential uniqueness, all RPCs
repointed, and `has_function_privilege('anon', fn, 'EXECUTE') = false` for every new
`SECURITY DEFINER` function.
