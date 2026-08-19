-- Template for a migration that creates a table. Not a migration itself: this file lives
-- outside supabase/migrations/ on purpose, so the CLI never applies it.
--
-- WHY THIS EXISTS
-- Supabase auto-grants every new public table to anon, authenticated AND service_role.
-- That stops for existing projects on 2026-10-30 (supabase discussion #45329). After the
-- cutover, a new table with no explicit GRANT is invisible over REST/GraphQL — including to
-- service_role, which is the role this entire application uses. The failure looks like a
-- permission error on brand-new code, so it gets debugged in the wrong place.
--
-- Tables that already exist keep their grants forever. This only concerns new ones.
-- Do NOT opt in to the new behaviour early; there is no benefit before the cutover.


-- ---------------------------------------------------------------------------
-- CHOOSE THE SCHEMA FIRST. It is the cheapest security decision available.
-- ---------------------------------------------------------------------------
--
--   public   — the app queries this table directly through supabase-js.
--   private  — nothing outside the database ever reads it: sync state, external-system id
--              maps, merge history, audit trails, job bookkeeping. `private` is not in the
--              Data API's exposed schemas, so PostgREST will not serve it at any grant or
--              policy setting. Reachable only from SECURITY DEFINER functions in `public`.
--
-- Schema membership documents reachability. Someone reading the schema list learns whether
-- a table has an HTTP surface without having to reason about grants and policies.


-- === OPTION A: app-facing table, in public ==================================

CREATE TABLE IF NOT EXISTS public.<table> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Load-bearing after 2026-10-30. service_role ONLY: RLS is enabled with no policies across
-- this database, so anon and authenticated hold grants that let them read nothing. Granting
-- them is noise that reads like intent. Add them only if the table is genuinely public, and
-- then write the policies to match.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO service_role;

-- Always. A table without RLS is readable by anyone holding the public anon key.
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

-- Only if anon or authenticated were granted above.
-- CREATE POLICY "<name>" ON public.<table> FOR SELECT TO authenticated USING (<predicate>);

-- If the table carries updated_at, attach the trigger. Nothing sets it otherwise, and a
-- column that silently never updates is worse than no column.
CREATE TRIGGER trg_<table>_updated_at
  BEFORE UPDATE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- === OPTION B: internal table, in private ===================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.<table> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No GRANT to anon or authenticated, ever. service_role only, and only because SECURITY
-- DEFINER functions run as their owner rather than the caller.
GRANT SELECT, INSERT, UPDATE, DELETE ON private.<table> TO service_role;

-- RLS is belt and braces here — the schema is not exposed — but enable it anyway, so the
-- table stays protected if `private` is ever added to the exposed schema list by accident.
ALTER TABLE private.<table> ENABLE ROW LEVEL SECURITY;

-- Access path: a SECURITY DEFINER function in public. Set search_path explicitly, and grant
-- EXECUTE to service_role alone unless a public caller genuinely needs it.
--
-- CREATE OR REPLACE FUNCTION public.<verb>_<thing>(p_arg uuid)
-- RETURNS <type> LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private
-- AS $$ BEGIN ... END $$;
--
-- REVOKE ALL ON FUNCTION public.<verb>_<thing>(uuid) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.<verb>_<thing>(uuid) TO service_role;


-- === BEFORE YOU APPLY =======================================================
--
-- Dev and prod are one database. Verify a SECURITY DEFINER function in a rolled-back
-- transaction first — see docs/solutions/best-practices/
-- verify-security-definer-rpc-do-block-rollback.md
--
-- If applied via the Supabase MCP, reconcile the version stamp immediately afterwards; it
-- stamps its own now() and ignores the filename. See CLAUDE.md.
