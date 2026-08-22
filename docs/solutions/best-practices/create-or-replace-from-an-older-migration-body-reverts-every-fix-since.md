---
title: "A CREATE OR REPLACE copied from an older migration silently reverts every fix since"
date: 2026-08-22
category: best-practices
module: events
problem_type: best_practice
component: database
severity: high
applies_when:
  - "Writing CREATE OR REPLACE FUNCTION for a Postgres function that already has prior declarations in supabase/migrations/"
  - "Threading a new column, argument, or branch through an existing RPC by pasting a body rather than hand-editing one"
  - "Reviewing a migration whose diff is an entire function body"
  - "Dev and prod share one Supabase database, so an RPC redeclare hits production the moment it runs"
  - "A feature has produced no rows, no errors and no complaints, and you are inclined to read that as working"
symptoms:
  - '`column "start_time" is of type time without time zone but expression is of type text`, surfaced to the admin as `Could not save event: Create failed: …`'
  - "A fix that shipped in its own migration reappears weeks later, while the newer migration's diff looks entirely correct in isolation"
  - "Admin event creation broken on production for about three and a half weeks with zero reports"
root_cause: missing_workflow_step
resolution_type: migration
related_components:
  - database
  - development_workflow
tags:
  - postgres
  - create-or-replace
  - supabase-migrations
  - rpc-regression
  - silent-regression
  - shared-prod-db
  - type-cast
  - events
---

# A `CREATE OR REPLACE` copied from an older migration silently reverts every fix since

## Context

`public.create_event_with_ticket_types(p_event jsonb, p_types jsonb)` builds its `INSERT INTO public.events` out of a jsonb argument, so every value starts life as `text`. `events.start_time` is declared `start_time time` (`supabase/migrations/20260402170058_create_events_table.sql:13`), and Postgres has **no assignment cast from `text` to `time`** — so the column needs an explicit `::time` the same way `start_date`/`end_date` already carry `::date`.

That cast has now been lost twice, and the second loss is the interesting one.

- `supabase/migrations/20260618120000_fix_event_create_start_time_cast.sql` existed for one reason: to add `::time` at line 36. Its header quotes the failure verbatim (`supabase/migrations/20260618120000_fix_event_create_start_time_cast.sql:2`).
- A month later, `supabase/migrations/20260721160100_create_event_rpc_description.sql` (PR #89) recreated the whole function via `CREATE OR REPLACE` to thread the new `event_ticket_types.description` column through the ticket-type `INSERT`. It did that job correctly — `description` appears in the column list at `supabase/migrations/20260721160100_create_event_rpc_description.sql:58` and in the `SELECT` at line 67. But its events `INSERT` is the **pre-fix** version of that line: `NULLIF(p_event->>'start_time', '')` with no cast (`supabase/migrations/20260721160100_create_event_rpc_description.sql:41`). Diff the two migrations and the only change to the events `INSERT` is the deleted cast.
- Admin event creation was then broken for everyone, for every input, from **2026-07-21 to 2026-08-14** — about three and a half weeks — until `supabase/migrations/20260814090000_fix_event_create_start_time_cast_again.sql` (PR #131) put the cast back at line 43.

The July migration was not careless about current state in general — it was authored the same day `is_child` stopped being written and correctly omits that column. What it missed was one line that a *different*, unrelated migration had fixed a month earlier. And the truly damning detail: the immediately preceding definition of this function, `supabase/migrations/20260721150000_stop_writing_is_child.sql:364` — about an hour earlier by version stamp, and merged the same afternoon (PR #80) — **did** carry `::time`. A correct, current body was sitting in the same directory, in the same day's work. The body that shipped came from further back.

Zoom out and the line has been wrong for most of the function's life. Six migrations declare this function; three of them lack the cast: the original `supabase/migrations/20260526131000_event_write_rpcs.sql:113`, `supabase/migrations/20260604200000_kids_tickets.sql:70`, and the July one. Only `20260618120000`, `20260721150000` and `20260814090000` have it.

## Guidance

**Before you write a `CREATE OR REPLACE FUNCTION`, obtain the function's *current* definition and diff your new body against it. Never start from an arbitrary older migration.**

Two ways to get the current body; use the first, and use the second as the tiebreaker when file history is ambiguous:

1. **Latest migration that declares the function.** A given function commonly has several ancestors in this repo, so pick the newest deliberately rather than by memory:

   ```bash
   grep -ril "create or replace function public.create_event_with_ticket_types" \
     supabase/migrations | sort | tail -1
   ```

   Filenames are timestamp-ordered, so `tail -1` is the newest declaration. Copy the body from *that* file.

2. **The live catalog** — the ground truth, especially given that a committed migration file is not proof it was applied (`CLAUDE.md`, "The database is shared"):

   ```sql
   SELECT pg_get_functiondef(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_event_with_ticket_types';
   ```

Then hold yourself to one rule: **after your edit, the diff between the current definition and your new body should contain your intended change and nothing else.** If a line you did not mean to touch shows up in that diff, you are reverting somebody's fix.

**Mark load-bearing fragments in the body itself.** The June fix left no signal inside the function that `::time` mattered; a five-character suffix with no test behind it and no comment beside it reads as noise to the next author. The August fix introduced the convention (`supabase/migrations/20260814090000_fix_event_create_start_time_cast_again.sql:43`):

```sql
    NULLIF(p_event->>'start_time', '')::time,  -- ::time is load-bearing; see header
```

and spelled out the reason in the header, including the instruction that any future `CREATE OR REPLACE` must copy the body from the latest migration, never an older one. Because the marker lives in the function body, it travels with every future copy-paste — which is exactly the transport that lost the cast in the first place. This is the same principle already captured in [`./a-comment-that-justifies-an-omission-is-load-bearing.md`](./a-comment-that-justifies-an-omission-is-load-bearing.md), applied to a fragment that is present rather than absent.

**On the shared database, fix production before you write the migration file.** Dev and prod are ONE Supabase project (`rmchkoktpzoojlglyfca`), no staging (`CLAUDE.md`, "The database is shared"). A broken function is not a pending defect waiting on a deploy — it is a live outage. So the usual order inverts: apply the `CREATE OR REPLACE` to prod first to unblock the user, then land the migration file in the repo (here, PR #131), then reconcile the ledger per `CLAUDE.md` — the MCP's `apply_migration` stamps its own `now()` version and ignores the filename, so the `supabase_migrations.schema_migrations` row must be corrected to the filename timestamp and live re-checked against the file.

Two properties worth knowing so you do not over-engineer the emergency fix. `CREATE OR REPLACE` does not drop and recreate the function, so grants survive — the `service_role` EXECUTE grant set by `supabase/migrations/20260809220000_revoke_anon_execute_secdef.sql:37` was preserved through the fix (verify, do not assume, via `information_schema.routine_privileges`). And because a plpgsql body is planned at first call, not at `CREATE` time, a body with a type error installs cleanly and fails only when someone actually uses it — which is precisely how a broken function sits in production for weeks looking healthy.

**Verify against production in a rolled-back transaction before you call it done.** The repo already has the recipe: [`./verify-security-definer-rpc-do-block-rollback.md`](./verify-security-definer-rpc-do-block-rollback.md). For this fix it was used to call the RPC for real with `start_time: "18:00"` (stored `18:00:00`) and with `start_time: ""` (stored `NULL`), each creating a ticket type alongside, inside a `DO` block that raises at the end to force a rollback — zero rows persisted. Don't restate that recipe in new migrations; link it.

## Why This Matters

**Review cannot see this class of regression.** The July migration's diff was correct in isolation: it added a column to a ticket-type `INSERT`, exactly what its title and header claimed. `CREATE OR REPLACE` of a whole function is a *full-body* rewrite presented as an *append-only* diff — git shows you a new file, so every line reads as new and intentional, and there is nothing on screen to compare the untouched lines against. The regression only becomes visible when you diff the new body against the **current** definition. Nobody does that by default, because git never asks you to.

**Absence of complaints is not evidence a feature works.** Nobody reported the outage for three and a half weeks. The proof of non-use is inverted and worth stating plainly: querying `events` for rows created in the broken window returned exactly one row, `[DEMO] Waitlist Offer Walkthrough` (created 2026-08-11), whose `start_time` is `18:30` — a value this RPC could not have produced, so it was inserted directly rather than through the admin path. The single row in the window is the evidence that the window was empty. If you are tempted to infer health from silence, go find the rows a working feature would have written.

**The blast radius was narrower than "events are broken", and knowing that mattered.** Only creation used the RPC. Editing an existing event goes through a PostgREST `.update()` with typed values (`app/api/admin/events/update/route.ts:83`) and is unaffected; `supabase/migrations/20260721160100_create_event_rpc_description.sql` declares only this one function, and no other RPC writes `start_time`.

**Test suites do not cover this.** `app/api/admin/events/create/route.test.ts` mocks `@/lib/supabase/admin` with a stub `rpc()` that captures its arguments and returns success. Line 81 asserts the RPC name; the rest assert the `p_types` payload shape and HTTP status. Nothing asserts on `p_event`, and the SQL body is never executed — so no amount of unit testing would have caught a type error in it. The rolled-back `DO`-block is the only mechanism in this repo that would have.

## When to Apply

- Any time you are about to write `CREATE OR REPLACE FUNCTION` for a Postgres function that already exists — especially one with more than one prior declaration in `supabase/migrations/`.
- Any time you are threading a new column, argument, or branch through an existing RPC and it is easier to paste a body than to hand-edit one.
- Any time you are reviewing a migration whose diff is a whole function: the review question is not "is this body correct?" but "what changed relative to the live definition?"
- Any time a feature has produced no rows, no errors and no complaints for a while, and you are inclined to read that as working.

## Examples

The one line that broke admin event creation for three and a half weeks. Before (`supabase/migrations/20260721160100_create_event_rpc_description.sql:38-42`):

```sql
    NULLIF(p_event->>'event_type_id', '')::uuid,
    (p_event->>'start_date')::date,
    NULLIF(p_event->>'end_date', '')::date,
    NULLIF(p_event->>'start_time', ''),
    NULLIF(p_event->>'location', ''),
```

After (`supabase/migrations/20260814090000_fix_event_create_start_time_cast_again.sql:40-44`):

```sql
    NULLIF(p_event->>'event_type_id', '')::uuid,
    (p_event->>'start_date')::date,
    NULLIF(p_event->>'end_date', '')::date,
    NULLIF(p_event->>'start_time', '')::time,  -- ::time is load-bearing; see header
    NULLIF(p_event->>'location', ''),
```

Note the two neighbours: `start_date` and `end_date` were already cast. The failing line sat between two correct ones, which is part of why it scans as fine.

**Why an empty Start Time field did not dodge it.** The intuition that "no time entered means no cast needed" is wrong, and this is the technicality the fix's header calls out. The route sends `start_time: start_time || null` (`app/api/admin/events/create/route.ts:109`), so an empty field arrives as JSON null; `p_event->>'start_time'` yields a `text` NULL, `NULLIF` keeps it `text`, and the `INSERT` expression's type is still `text` regardless of value. Postgres rejects it at plan time. **Every** call failed — with a time, without a time, empty string or null — with:

```
column "start_time" is of type time without time zone but expression is of type text
```

surfaced to the admin as `Could not save event: Create failed: …` (`components/admin/EventManager.tsx:350`).

**The check that would have caught it, in one command.** Standing at the July migration, before writing a line:

```bash
grep -ril "create or replace function public.create_event_with_ticket_types" \
  supabase/migrations | sort | tail -1
# -> supabase/migrations/20260721150000_stop_writing_is_child.sql   (has ::time)
```

That file — an hour earlier in migration order — was the correct starting body. Copying from it — and diffing the result against it — leaves `description` as the only change.

## Related

- [`./verify-security-definer-rpc-do-block-rollback.md`](./verify-security-definer-rpc-do-block-rollback.md) — the rolled-back `DO`-block used to smoke-test this fix against production with zero residue. Use it after every `CREATE OR REPLACE` here.
- [`./prove-a-hot-function-rewrite-byte-for-byte-before-shipping.md`](./prove-a-hot-function-rewrite-byte-for-byte-before-shipping.md) — the stronger form of the same instinct: when a rewrite must not change existing results, prove old-vs-new equivalence against real rows rather than reading the diff. Note that its "copy the unchanged term verbatim from the current function" instruction is exactly right, and that this incident is what happens when "current" resolves to an older migration file.
- [`./a-comment-that-justifies-an-omission-is-load-bearing.md`](./a-comment-that-justifies-an-omission-is-load-bearing.md) — companion principle for the inline marker convention: a comment carrying a non-obvious invariant is part of the code, and must survive rewrites.
- [`../architecture-patterns/live-table-rename-on-shared-prod-db.md`](../architecture-patterns/live-table-rename-on-shared-prod-db.md) — operating on the shared dev/prod Supabase project. Its step 3 already observed that migration files lag the live function bodies; this incident promotes that from a local nuisance into a standing hazard.
- [`../logic-errors/add-to-calendar-link-missing-when-postgres-time-parsed-as-hh-mm.md`](../logic-errors/add-to-calendar-link-missing-when-postgres-time-parsed-as-hh-mm.md) — the other `events.start_time` trap, and the same silent-failure-with-zero-reports signature: that one is Postgres `time` misread on the way *out* of the DB, this one is `text` refused on the way *in*.
- PR #89 introduced the regression; PR #131 fixed it and added the marker convention. The first occurrence was fixed by PR #45 (`supabase/migrations/20260618120000_fix_event_create_start_time_cast.sql`).
