-- Event messaging: associate a broadcast row with an event and a message kind,
-- and add the double-send guard surface.
--
-- The broadcasts table is reused for event-scoped messages (pre-event logistics
-- and post-event thank-yous). Member broadcasts keep event_id NULL and
-- kind='member', so they are excluded from the per-event tab queries and from
-- both guard indexes below.

ALTER TABLE public.broadcasts
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'member',
  ADD COLUMN idempotency_key text;

COMMENT ON COLUMN public.broadcasts.event_id IS
  'Event this message targets. NULL for member broadcasts.';
COMMENT ON COLUMN public.broadcasts.kind IS
  'Message kind: member (audience broadcast), event_pre (registered attendees), event_post (checked-in attendees).';
COMMENT ON COLUMN public.broadcasts.idempotency_key IS
  'Client-supplied key for event sends; dedupes a retried send. NULL for member broadcasts.';

-- Explicit, enforced kind set (mirrors the broadcasts_status_check pattern).
ALTER TABLE public.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_kind_check;
ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_kind_check
  CHECK (kind IN ('member', 'event_pre', 'event_post'));

-- Per-event tab query: list this event's sends.
CREATE INDEX IF NOT EXISTS broadcasts_event_id_idx
  ON public.broadcasts (event_id);

-- Double-send guard #1: at most one in-flight event send per (event, kind).
-- A concurrent double-submit (one admin double-clicking, or two admins sending
-- at once) collides on this index; the loser's INSERT raises 23505, which the
-- send path classifies as a benign "already in progress". Scoped to event sends
-- only — member rows (event_id NULL) are excluded, so concurrent member
-- broadcasts are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_event_inflight_uniq
  ON public.broadcasts (event_id, kind)
  WHERE status = 'sending' AND event_id IS NOT NULL;

-- Double-send guard #2: a retried request (lost response) reuses its
-- idempotency_key and collides here, so the route returns the existing send's
-- result instead of dispatching again. NULL keys (member broadcasts) are
-- excluded and never collide.
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_idempotency_key_uniq
  ON public.broadcasts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
