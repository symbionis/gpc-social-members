-- Allow 'draft' as a valid broadcasts.status value alongside the existing
-- runtime values ('sending', 'sent', 'failed'). The column is plain text;
-- this migration adds a CHECK constraint so the allowed set is explicit and
-- enforced at the database layer.
--
-- Drafts represent in-progress composer state: a row exists but has not yet
-- been handed to the channel adapter. The send pipeline transitions a draft
-- row through 'sending' → 'sent' / 'failed' rather than inserting a new row.

-- Drop any pre-existing status check constraint so this migration is
-- idempotent across environments where the column may have been free-form.
ALTER TABLE public.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_status_check;

ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('draft', 'sending', 'sent', 'failed'));
