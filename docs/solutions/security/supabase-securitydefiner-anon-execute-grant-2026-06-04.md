---
title: "Supabase SECURITY DEFINER functions stay anon-executable after REVOKE ... FROM PUBLIC"
date: 2026-06-04
last_updated: 2026-08-09
category: security
module: database
problem_type: security_issue
component: database
symptoms:
  - "REVOKE ALL ... FROM PUBLIC leaves a SECURITY DEFINER function still callable with the public anon key"
  - "has_function_privilege('anon', oid, 'EXECUTE') returns true for a function believed to be service-role-only"
  - "POST /rest/v1/rpc/<fn> succeeds unauthenticated and bypasses RLS, because a SECURITY DEFINER function runs as its owner"
root_cause: missing_permission
resolution_type: migration
severity: high
related_components:
  - events
  - supabase-migrations
tags:
  - supabase
  - postgres
  - security-definer
  - anon-key
  - postgrest
  - grants
  - rls
  - least-privilege
---

# Supabase SECURITY DEFINER functions stay anon-executable after `REVOKE ... FROM PUBLIC`

## The trap

Our `SECURITY DEFINER` Postgres functions are created with this pattern (e.g. `create_event_registration`, `import_event_attendees`):

```sql
REVOKE ALL ON FUNCTION public.fn(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn(...) TO service_role;
```

This is **not sufficient** to make the function service-role-only on Supabase. Supabase ships an `ALTER DEFAULT PRIVILEGES` that **grants EXECUTE on every new `public` function to `anon`, `authenticated`, and `service_role`**. `REVOKE ... FROM PUBLIC` removes only the implicit `PUBLIC` grant — it does **not** remove those explicit role grants. So the function remains callable through PostgREST with the **public anon key** (`POST /rest/v1/rpc/<fn>`), and because it is `SECURITY DEFINER` it runs as the owner and **bypasses RLS**.

Verify with:

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true;
```

## The fix

Revoke from the roles explicitly, not just `PUBLIC`:

```sql
REVOKE ALL ON FUNCTION public.fn(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn(...) TO service_role;
```

(All event RPCs are only ever called via `createAdminClient()` / the service-role key, so revoking anon/authenticated breaks no legitimate caller.)

## State — closed as of 2026-08-09 (prod project `rmchkoktpzoojlglyfca`)

Every `SECURITY DEFINER` function in `public` is now service-role-only. Running the verification query above returns `anon_exec = false` for all of them.

| functions | closed |
| --- | --- |
| `seed_lead_attendee`, `import_event_attendees` | 2026-06-04, alongside the guest-roster feature |
| `create_event_registration`, `create_event_with_ticket_types`, `seats_used`, `seats_used_by_events` | 2026-08-09, by `supabase/migrations/20260809220000_revoke_anon_execute_secdef.sql` (PR #100) |

Prefer re-running the query over trusting this table — a state assertion in prose ages, the query does not.

### Why the second group took nine weeks

The four in the bottom row were diagnosed here on 2026-06-04, with the exact remediation and the safety analysis already written, and then deferred as *"accepted risk … flagged for a future hardening pass."* Nothing scheduled that pass. They were closed only when an unrelated Supabase advisor alert — about a **different** exposure class — prompted a full catalog audit nine weeks later.

The deferral was defensible; leaving it without an owner or a date was not. A flagged-and-forgotten risk reads exactly like an unnoticed one, and in the meantime this section quietly asserted a live hole that a reader would have believed.

## Takeaway

Any new `SECURITY DEFINER` function in this repo's migrations must use `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — `FROM PUBLIC` alone is a false sense of security on Supabase.

Functions are only one of the two gates. Tables have their own, independent one: RLS. A table with RLS disabled is wide open to the anon key regardless of any function grant, because Supabase grants `anon` full DML on every table by default. See [`supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md`](supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md) for that half, the catalog audit queries covering both gates, and why black-box probing cannot prove a write is blocked.
