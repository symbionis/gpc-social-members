-- Multiple ticket types per event — additive schema (phase 1 of the cutover).
--
-- Replaces the single-ticket model (three price columns on events:
-- price_member / price_non_member / invite_price) with:
--   event_ticket_types        one or more named, priced types per event
--   event_registration_items  per-type line items under a registration
-- and adds a desired type+quantity to event_waitlist signups.
--
-- This migration is ADDITIVE ONLY. It creates the new tables, seeds a
-- "Standard" type per event from the existing event price columns, backfills
-- one line item per existing registration, and backfills waitlist rows. The
-- three events price columns are NOT touched here — they are dropped in a
-- later, irreversible cutover migration after all code reads ticket types.
--
-- DEPLOY ORDERING: safe to apply before the cutover code ships — nothing reads
-- the new tables yet, and the old columns are untouched, so older deployments
-- keep working. NB: dev and prod share one Supabase database, so applying this
-- mutates production immediately. The seed/backfill are guarded with
-- NOT EXISTS so the migration is re-runnable (a re-apply double-counts nothing).
-- PRE-FLIGHT (run before applying against the shared DB): confirm row volume
-- (SELECT count(*) FROM event_registrations) and that the COALESCE below covers
-- any NULL unit_amount_chf / total_amount_chf on legacy rows.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_ticket_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  title            text NOT NULL,
  -- Three price dimensions, mirroring the columns being retired from events.
  -- Visibility-dependent null rules (members_only => non_member null; public
  -- => invite null; price_member required when registration enabled) are
  -- enforced in the single-writer route (lib/events/ticket-types.ts), not as a
  -- cross-table CHECK, since a column CHECK cannot reach the parent event.
  price_member     numeric(10,2),
  price_non_member numeric(10,2),
  invite_price     numeric(10,2),
  counts_as_seat   boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ticket_types_prices_nonneg CHECK (
    (price_member IS NULL OR price_member >= 0)
    AND (price_non_member IS NULL OR price_non_member >= 0)
    AND (invite_price IS NULL OR invite_price >= 0)
  )
);

CREATE INDEX IF NOT EXISTS event_ticket_types_event_id_idx
  ON public.event_ticket_types (event_id);
CREATE INDEX IF NOT EXISTS event_ticket_types_active_idx
  ON public.event_ticket_types (event_id, sort_order)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.event_registration_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  -- RESTRICT: a type referenced by an item must not be hard-deleted; the
  -- single-writer route archives instead (sets archived_at).
  ticket_type_id   uuid NOT NULL REFERENCES public.event_ticket_types(id) ON DELETE RESTRICT,
  -- Snapshot of the type's title and unit price at registration time, so a
  -- later rename / reprice / archive leaves historical records immutable.
  title_snapshot   text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity >= 1),
  unit_amount_chf  numeric(10,2) NOT NULL,
  line_total_chf   numeric(10,2) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_registration_items_registration_id_idx
  ON public.event_registration_items (registration_id);
CREATE INDEX IF NOT EXISTS event_registration_items_ticket_type_id_idx
  ON public.event_registration_items (ticket_type_id);

-- Waitlist captures the desired type + quantity at signup. ticket_type_id is
-- SET NULL on type delete; the single-writer route archives (never hard-deletes)
-- a type still referenced by a waitlist row, so this should not fire in practice.
ALTER TABLE public.event_waitlist
  ADD COLUMN IF NOT EXISTS ticket_type_id uuid REFERENCES public.event_ticket_types(id) ON DELETE SET NULL;
ALTER TABLE public.event_waitlist
  ADD COLUMN IF NOT EXISTS quantity integer;

-- ---------------------------------------------------------------------------
-- Seed + backfill (idempotent)
-- ---------------------------------------------------------------------------

-- One "Standard" type per event, carrying that event's current prices. Info-only
-- events (all prices null) are seeded too — the all-null type is gated at every
-- read (register fails loud, the form shows "not open yet"); skipping them would
-- leave a later "enable registration" with no type to price.
INSERT INTO public.event_ticket_types
  (event_id, title, price_member, price_non_member, invite_price, counts_as_seat, sort_order)
SELECT e.id, 'Standard', e.price_member, e.price_non_member, e.invite_price, true, 0
FROM public.events e
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_ticket_types t WHERE t.event_id = e.id
);

-- One line item per existing registration, referencing that event's seeded
-- "Standard" type. COALESCE guards legacy rows with NULL amounts (the item
-- columns are NOT NULL); without it a single NULL would abort the whole
-- transaction with 23502 on the shared DB.
INSERT INTO public.event_registration_items
  (registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf)
SELECT r.id, t.id, 'Standard', r.quantity,
       COALESCE(r.unit_amount_chf, 0), COALESCE(r.total_amount_chf, 0)
FROM public.event_registrations r
JOIN public.event_ticket_types t
  ON t.event_id = r.event_id AND t.title = 'Standard' AND t.sort_order = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_registration_items i WHERE i.registration_id = r.id
);

-- Point legacy waitlist rows at the seeded "Standard" type. quantity stays NULL
-- (these predate the field); the convert route falls back to qty 1.
UPDATE public.event_waitlist w
SET ticket_type_id = t.id
FROM public.event_ticket_types t
WHERE t.event_id = w.event_id AND t.title = 'Standard' AND t.sort_order = 0
  AND w.ticket_type_id IS NULL;

-- ---------------------------------------------------------------------------
-- RLS: enable with no policies — anon/authenticated denied, only the
-- service-role key (used by all app code via createAdminClient) can read/write.
-- Mirrors event_checkins and the other event child tables.
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_items ENABLE ROW LEVEL SECURITY;
