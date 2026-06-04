---
name: supabase-securitydefiner-anon-execute-grant
description: REVOKE ... FROM PUBLIC does NOT make a Supabase SECURITY DEFINER function service_role-only — default privileges still grant EXECUTE to anon/authenticated, exposing it via the public anon key.
metadata:
  type: security
  area: database
  discovered: 2026-06-04
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

## State as of 2026-06-04 (prod project `rmchkoktpzoojlglyfca`)

- **Fixed:** `seed_lead_attendee`, `import_event_attendees` (the guest-roster feature's functions) — revoked from anon/authenticated.
- **Pre-existing, still anon-executable (accepted risk for this club app, low real-world threat — flagged for a future hardening pass):**
  - `create_event_registration` — HIGH: anon could forge a registration with `status='paid'` without paying.
  - `create_event_with_ticket_types` — HIGH: anon could create arbitrary events + ticket types.
  - `seats_used`, `seats_used_by_events` — LOW: read-only seat counts.

  One-line `REVOKE ... FROM anon, authenticated` per function closes each; every caller uses the service-role admin client, so it's safe whenever the team wants to apply it.

## Takeaway

Any new `SECURITY DEFINER` function in this repo's migrations must use `REVOKE ALL ... FROM PUBLIC, anon, authenticated` — `FROM PUBLIC` alone is a false sense of security on Supabase.
