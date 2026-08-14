---
title: "Supabase anon exposure has two independent gates: RLS on the table and EXECUTE on the function"
date: 2026-08-09
last_updated: 2026-08-14
category: security
module: database
problem_type: security_issue
component: database
symptoms:
  - Supabase advisor raised rls_disabled_in_public for one table, but four tables actually had RLS off
  - broadcast_recipients (3,229 rows, the full member mailing list) was readable, writable and deletable by anyone holding the public anon key
  - Four SECURITY DEFINER functions were still EXECUTE-able by anon via POST /rest/v1/rpc/
  - A black-box DELETE probe using a zero-match filter returned HTTP 204 for tables that were in fact protected, wrongly flagging two of them as anon-writable
root_cause: missing_permission
resolution_type: migration
severity: critical
related_components:
  - broadcasts
  - events
  - supabase-migrations
tags:
  - supabase
  - postgres
  - rls
  - security-definer
  - anon-key
  - postgrest
  - advisor
  - least-privilege
---

# Supabase anon exposure has two independent gates: RLS on the table and EXECUTE on the function

## Problem

A Supabase advisor alert fired: **"Table publicly accessible — `rls_disabled_in_public`"**, naming a single table. Treated at face value it looked like a one-line fix.

It wasn't. Auditing the database catalog rather than the alert text turned up two distinct classes of live public exposure on a shared dev/prod Supabase project (`rmchkoktpzoojlglyfca`):

1. **Four tables with RLS disabled**, all of them granting full DML to `anon` — meaning anyone with the project URL and the public anon key (both shipped to every browser) could read, modify or delete every row.
2. **Four `SECURITY DEFINER` functions still executable by `anon`** — including one that creates real events, and one proven to return live production data over PostgREST with nothing but the anon key.

The alert named one object. The catalog named eight.

## Symptoms

**Class 1 — RLS off on four tables.** The authoritative check is `pg_class.relrowsecurity`, not the dashboard badge:

```sql
select relname, relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

Four rows came back, with production row counts recorded in the migration header at `supabase/migrations/20260809120000_enable_rls_exposed_tables.sql:6-9`:

| table | rows | contents |
| --- | --- | --- |
| `broadcast_recipients` | 3,229 | the full member mailing list |
| `event_reminder_sends` | 584 | per-member send log |
| `broadcasts` | 45 | message bodies |
| `event_waitlist` | 21 | name/contact of waitlisted people |

`information_schema.role_table_grants` showed each of the four granting `DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE` to **both** `anon` and `authenticated`. That is the Supabase default, and it is the whole point: on Supabase, RLS is the only gate. Grants do not restrict anything. RLS off therefore means *no gate at all* — not "read-only", not "authenticated-only". `broadcast_recipients` is the severe one: the member mailing list was world-readable and world-deletable.

**Class 2 — anon-executable `SECURITY DEFINER` functions.** Postgres grants `EXECUTE` to `PUBLIC` by default on every new function. Measured against the live catalog on 2026-08-09, fifteen of the nineteen `SECURITY DEFINER` functions in `public` had already been locked down by earlier migrations. Four had been missed:

- `create_event_with_ticket_types(jsonb, jsonb)` — anon could create real events
- `create_event_registration(uuid, text, text, boolean, uuid, text, text, timestamptz, uuid, jsonb)` — anon could create registrations and consume seats
- `seats_used(uuid)`
- `seats_used_by_events(uuid[])`

Because they are `SECURITY DEFINER`, they execute as the owner and bypass RLS entirely — so a table that *is* protected by RLS is still reachable through a function that isn't locked down.

This was proven reachable, not merely granted in the catalog. `POST /rest/v1/rpc/seats_used` with the public anon key returned HTTP 200 and a live count (577).

And this half was **already documented, correctly, nine weeks earlier**. `docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md` (added 2026-06-04 by PR #39, commit `5b29501`) names all four of these functions, explains the exact mechanism, gives the exact one-line remediation, and states that every caller uses the service-role admin client so revoking is safe. It filed them under:

> **Pre-existing, still anon-executable (accepted risk for this club app, low real-world threat — flagged for a future hardening pass)**

The diagnosis was right, the fix was known, the safety analysis was done. It sat for ~9 weeks and was closed only because an unrelated alert about a *different* class prompted a full catalog audit.

## What Didn't Work

**This is the part worth remembering.** The first probe concluded that **six** tables were anon-writable. Two of them — `membership_tiers` and `seasons` — were false positives, and the reason generalises to any black-box permission test against PostgREST.

The probe issued `DELETE` and `PATCH` with a deliberately non-matching filter, so it would not touch real data:

```bash
curl -X DELETE "$URL/rest/v1/membership_tiers?id=eq.00000000-0000-0000-0000-000000000000" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# -> HTTP 204
```

and treated `204` as "write allowed".

**That inference is invalid.** With RLS *enabled* and no `UPDATE`/`DELETE` policy, PostgREST still returns `204`. RLS filters *which rows are affected*; it does not raise an error. "Zero rows matched the filter" and "zero rows survived the policy" are indistinguishable at the HTTP layer. A genuine permission failure (`42501`) surfaces only when the **role lacks the table grant** — which on Supabase defaults is never the case, since `anon` holds the grant on everything. So the write probe was structurally incapable of returning a negative.

In fact `membership_tiers` and `seasons` had RLS enabled with an intentional `SELECT ... USING (true)` policy for role `public` (public pricing and season data) and no write policy. Writes were already denied. This was established by querying `pg_policies` on the live database. A first pass through the repo appeared to confirm the policies existed nowhere in the tree — that was wrong. They are in `supabase/migrations/20260324101510_add_rls_policies_and_seed_data.sql:16` (with the `ENABLE ROW LEVEL SECURITY` statements at lines 7 and 13), written in uppercase (`CREATE POLICY "Tiers are publicly readable" ON membership_tiers FOR SELECT USING (true);`) and missed by a case-sensitive `grep create policy`. Trust the catalog over the tree — but note the tree here was not silent, only mis-searched. **A grep that returns nothing is not evidence of absence.** Per the migration's own note at `20260809120000_enable_rls_exposed_tables.sql:16-21`, they were deliberately excluded from the fix.

Two corollaries:

- The **read** half of the probe was sound. Comparing an anon row count against a service-role row count *is* a valid signal, because RLS genuinely filters reads. The asymmetry is specific to writes.
- The correct sources are the catalog, always: `pg_class.relrowsecurity`, `pg_policies`, `information_schema.role_table_grants`, `has_function_privilege('anon', oid, 'EXECUTE')`. Probing tells you what an endpoint *did*; the catalog tells you what it *permits*.

## Solution

> **Verified live 2026-08-14 (catalog, not migrations).** This doc's own advice is to trust the
> catalog over the tree, so the closure was re-checked against the running database rather than
> inferred from migration files:
>
> - **Every `SECURITY DEFINER` function in `public` is `service_role` only.** `has_function_privilege`
>   returns false for both `anon` and `authenticated` on all of them, including
>   `create_event_with_ticket_types`, `create_event_registration`, `claim_ticket`,
>   `checkin_by_credential`, `apply_pending_roster`, `apply_registration_topup`,
>   `mint_registration_tickets`, `seed_lead_attendee` and `rotate_ticket_manage_token`.
> - **RLS is enabled on all 27 `public` tables.** Most carry zero policies, which with RLS on is
>   deny-all for `anon`/`authenticated`; only `service_role` bypasses.
> - **The `CREATE OR REPLACE` grant-preservation claim held in practice.** Two migrations landed on
>   2026-08-14 (`20260814090000`, `20260814150000`) redefining `create_event_with_ticket_types` and
>   `claim_ticket`; both functions are still `service_role` only afterwards.
>
> Re-run before trusting this: `select p.proname from pg_proc p join pg_namespace n on
> n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and
> has_function_privilege('anon', p.oid, 'EXECUTE');` — must return zero rows.
>
> Still unverified from the repo, and worth a platform check before the next revoke: the complete
> list of **deployed Edge Functions** (the tree structurally cannot enumerate them), and the
> point-in-time `.rpc()` call-site audit below, which must be re-run rather than trusted.


Shipped as **PR #100** (`fix(security): close RLS and SECURITY DEFINER exposure, tighten admin role enforcement`) on `symbionis/gpc-social-members` — merged as commit `986bf34`, branch `symbionis/investigate-error-alert`. Both migrations were applied to production *during* the investigation, because the holes were live, and committed afterwards; the repo followed prod rather than leading it. Migrations were pushed via the Supabase Management API (`POST /v1/projects/{ref}/database/query`) because the Supabase MCP tools were unavailable in-session.

**Migration 1 — `supabase/migrations/20260809120000_enable_rls_exposed_tables.sql`:**

```sql
alter table public.broadcast_recipients enable row level security;
alter table public.event_reminder_sends enable row level security;
alter table public.broadcasts           enable row level security;
alter table public.event_waitlist       enable row level security;
```

and **deliberately no policies**. Every application query against these four goes through the service-role admin client (`lib/supabase/admin.ts:5`, `createAdminClient()`), which bypasses RLS. RLS-on with zero policies is therefore deny-all for `anon`/`authenticated` and a complete no-op for the app. This mirrors an existing house convention — `event_registration_topups` (`supabase/migrations/20260622220000_registration_topups.sql:21`) and `event_ticket_type_conversions` (`supabase/migrations/20260708120000_ticket_type_conversions.sql:37`) are already service-role-only tables with RLS on.

The migration ends with a `DO`-block guard: because RLS was off, any policy previously defined on these tables was *inert*, and enabling RLS activates it. The guard raises if any such policy would still expose the table to `anon`/`authenticated`, rather than leaving a hole behind an "RLS enabled" badge.

Verification afterwards: anon `SELECT` returns 0 rows on all four while service-role still returns the full counts; zero `public` tables without RLS.

**Migration 2 — `supabase/migrations/20260809220000_revoke_anon_execute_secdef.sql`:**

```sql
revoke all on function public.seats_used(uuid) from public, anon, authenticated;
grant execute on function public.seats_used(uuid) to service_role;
```

…repeated for all four functions, followed by a `DO`-block guard over `pg_proc`.

Verification: the same `POST /rest/v1/rpc/seats_used` that returned 200 and a live count now returns **HTTP 401** with `{"code":"42501","message":"permission denied for function seats_used"}`.

Crucially, **the pattern was already documented in this repo** and simply wasn't applied uniformly. `supabase/migrations/20260708120000_ticket_type_conversions.sql:173-176`:

```sql
-- FROM PUBLIC alone leaves SECURITY DEFINER functions anon-callable on Supabase; revoke
-- from anon/authenticated too and grant only to the service role (mirrors fill_ticket).
revoke all on function public.apply_ticket_type_conversion(uuid) from public, anon, authenticated;
grant execute on function public.apply_ticket_type_conversion(uuid) to service_role;
```

**Safety analysis before revoking.** Revoking `EXECUTE` breaks anything calling these RPCs with a non-service-role client, so every caller was traced first:

- All **21** `.rpc()` call sites across `app/`, `lib/`, `components/`.
- All callers of the `lib/events/seat-usage.ts` helpers — the real risk, because that module takes an **injected** client (`getSeatsUsed(supabase, eventId)` at `lib/events/seat-usage.ts:22-26`), so its safety depends entirely on what each caller passes in.
- The public token-based booking routes: `app/api/public/bookings/[token]/topup/route.ts:57` and `app/api/public/bookings/[token]/convert/route.ts:43` — both `createAdminClient()`.
- The door console: `lib/events/door-access.ts` makes zero `.rpc()` calls.
- The check-in pages.
- No `.rpc()` sits inside a `"use client"` component (verified by scanning every `.rpc()`-containing file for the directive).
- No Edge Function calls any of the four. `supabase/functions` is absent from the merged tree, but *absent from the tree is not absent from the platform*: `supabase/functions/sinch-sms/index.ts` exists on the unmerged PR #44 branch and was deployed to the project via MCP. It was read and makes no Supabase client or `.rpc()` call, so the revoke was safe — but enumerate deployed Edge Functions from the platform (`supabase functions list`), never from the repo tree.

Even the **public, unauthenticated** event registration route uses the admin client: `app/api/events/[id]/register/route.ts:110`. That is what made the revoke a pure permission tightening with no accompanying code change, safely applicable independent of any deploy.

## Why This Works

The whole thing turns on one asymmetry in the Supabase model: **grants are permissive by default and RLS is the only real gate — except for `SECURITY DEFINER` functions, where RLS is bypassed and grants become the only gate.** Two mechanisms, opposite polarity, and a hole in either is total.

- Enabling RLS with **no policies** is the strongest possible posture for a table only the service role touches. There is nothing to get subtly wrong, no `USING` clause to reason about, no policy that quietly widens later. The service-role key bypasses RLS by design, so the app is unaffected; everyone else gets an empty set. This is why "no policies" here is a deliberate choice, not an omission.
- Revoking from `public, anon, authenticated` (rather than `FROM PUBLIC` alone) is required because Supabase grants those roles membership directly — dropping the `PUBLIC` grant leaves the direct grants standing. That is exactly what the 2026-07-08 comment says, and exactly the trap the four missed functions fell into.
- Granting back only to `service_role` means the app's single privileged path keeps working while the anon key's reach drops to zero.
- The `DO`-block guards convert a one-time cleanup into a **standing invariant**. A migration that raises on a violation cannot be quietly regressed by a later migration that reintroduces one.

## Prevention

### Audit SQL — run these, don't probe

**Tables with RLS off (should return zero rows):**

```sql
select relname, relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

**`SECURITY DEFINER` functions still executable by anon (should return zero rows):**

```sql
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```

**What `anon`/`authenticated` are actually granted, per table:**

```sql
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;
```

Expect this last one to be wide open everywhere — that is the Supabase default and is *not* the finding. It is the reason RLS-off is fatal.

**Policies on a given table:**

```sql
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;
```

### The durable mechanism: a `DO`-block guard in the migration

Both migrations end with a self-check that raises instead of merely fixing. From `supabase/migrations/20260809220000_revoke_anon_execute_secdef.sql`:

```sql
do $$
declare
  offending text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into offending
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if offending is not null then
    raise exception
      'SECURITY DEFINER functions still executable by anon: %', offending;
  end if;
end $$;
```

Copy this shape into any future security migration. A fix that only fixes is a fix that decays; a fix that asserts is a fix that holds.

### The rule

**On Supabase, RLS-on and revoke-EXECUTE are part of *creating* the object, not cleanup afterwards.** Both defaults are permissive:

- `create table` → `anon` and `authenticated` get full DML, and without RLS there is nothing between them and the data.
- `create function ... security definer` → `EXECUTE` is granted to `PUBLIC`, and the function bypasses RLS.

So every new table migration ends with `alter table ... enable row level security` plus either explicit policies or a comment saying "service-role only, deliberately no policies". Every new `SECURITY DEFINER` function migration ends with `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`. `FROM PUBLIC` alone is not enough.

### An "accepted risk" with no trigger is just an open hole

Half of this work — the four `SECURITY DEFINER` functions — was diagnosed, written up, and given its exact fix on 2026-06-04. It was then deferred as *"accepted risk … flagged for a future hardening pass."* Nothing was wrong with that judgement at the time. What was missing was a **trigger**: nothing scheduled the pass, nothing re-surfaced the note, and the doc's own "State as of" section quietly aged into a false statement about production.

Nine weeks later it was closed only because an unrelated alert forced a catalog-wide audit. Two things follow:

- A deferral needs an owner and a date, or it needs to not be a deferral. "Flagged for a future pass" with neither is indistinguishable from an unnoticed hole — the knowledge was captured perfectly and still did not help.
- A doc that asserts current production state (`State as of <date>`) acquires a maintenance obligation. Either re-verify it when the thing changes, or write it as a point-in-time finding that must be re-checked rather than trusted. Prefer a re-runnable query over a prose assertion — the audit SQL above stays true; the sentence does not.

### Read the advisors on a schedule, not on alert

Supabase's own advisors catch **both** classes: `rls_disabled_in_public` and `anon_security_definer_function_executable` (plus `authenticated_security_definer_function_executable`). The `SECURITY DEFINER` findings here had presumably been sitting in advisor output the whole time; only the table lint generated an email. The compounding fix is to read the full advisor report periodically rather than reacting to whichever lint happens to page you:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/advisors/security" | jq '.lints[] | {name, level, detail}'
```

Same API surface can apply the fix when MCP tooling is unavailable: `POST /v1/projects/{ref}/database/query`.

### Expected residual — do not "fix" this

After these migrations, the four tables raise `rls_enabled_no_policy` **INFO** lints. That is correct and intended for service-role-only tables: RLS on with zero policies is deny-all, which is the strongest posture available. Adding a policy to silence the lint would *weaken* it. Note the exclusion explicitly wherever the advisor output is triaged, so a future reader doesn't "resolve" it.

### One more note on the environment

This project runs a **shared dev/prod Supabase database** — a migration applied anywhere is applied to production. That cuts both ways: it is why these two permission-only migrations could be applied immediately and safely (no schema change, no data change, no code dependency), and it is why anything that *isn't* permission-only needs the opposite caution.

## Related

- `docs/solutions/security/supabase-securitydefiner-anon-execute-grant-2026-06-04.md` — **direct predecessor.** Documents the `SECURITY DEFINER` grant trap and names all four functions closed here. It was updated on 2026-08-09 and its state section now reads "closed as of 2026-08-09", crediting `20260809220000_revoke_anon_execute_secdef.sql`. Read this doc alongside it: that one owns the function gate, this one owns the table gate.
- `docs/solutions/design-patterns/race-safe-claim-rpc-capacity-cap.md` — explains *why* "RLS on, no policies" is the right posture for service-role-only tables rather than writing policies.
- `docs/solutions/architecture-patterns/live-table-rename-on-shared-prod-db.md` — same threat model via an adjacent mechanism: a default (`security_invoker = false`) view bypasses base-table RLS and leaks to anon.
- `docs/solutions/best-practices/verify-security-definer-rpc-do-block-rollback.md` — the repo's rolled-back-`DO`-block technique for proving RPC behaviour on the shared prod DB; the transactional-probe counterpart to this doc's catalog queries.
- `docs/solutions/integration-issues/stripe-supabase-payment-flow-integration-issues.md` — the opposite failure mode on the same axis: RLS too strict, silently swallowing member inserts.
- PR #100 — ships both migrations (merged, commit `986bf34`). PR #39 / commit `5b29501` — origin of the predecessor doc.
