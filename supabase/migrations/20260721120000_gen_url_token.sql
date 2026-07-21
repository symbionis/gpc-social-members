-- U1 — shared base64url token generator.
-- Plan: docs/plans/2026-07-20-001-feat-ticket-naming-and-guest-self-service-plan.md
--
-- ADDITIVE: the base64url(gen_random_bytes(24)) expression has been hand-copied
-- 13+ times across migrations (claim_ticket, fill_ticket, batch forwarding,
-- self_reg_token backfill, comp guest list, credential minting...). This is the
-- single Postgres-side source of truth for that shape, mirroring the app-side
-- generateSelfRegToken() in lib/events/registration.ts:52-61. Safe to deploy
-- anytime — nothing calls it yet; U9 is the first caller (per-ticket manage_token).
create or replace function public.gen_url_token()
 returns text
 language sql
 volatile
 set search_path to 'public'
as $function$
  select replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');
$function$;

revoke all on function public.gen_url_token() from public, anon, authenticated;
grant execute on function public.gen_url_token() to service_role;
