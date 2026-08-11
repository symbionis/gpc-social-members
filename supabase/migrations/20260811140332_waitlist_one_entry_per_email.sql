-- One waitlist entry per email per event.
--
-- The signup route checks first and returns a readable error; this is the race-safe
-- backstop for two submissions in flight at once (the route's own 23505 branch turns it
-- back into the same message). Emails are stored normalised by the signup route, but the
-- index lowers and trims anyway so a legacy row cannot slip a near-duplicate past it.
--
-- SHARED DEV/PROD DATABASE: this applies to production immediately.
-- Safe to add — verified before applying that no event had two entries sharing an email.
--
-- Note the trade-off: two people sharing one mailbox can no longer both queue for the same
-- event. That is the intended rule (a waitlist entry is one named person, one ticket), but
-- it is a rule about a MAILBOX standing in for a person, so if the club ever needs a couple
-- on one address, this index is what has to change.
create unique index if not exists event_waitlist_event_email_unique
  on public.event_waitlist (event_id, lower(trim(email)));

-- Rollback (manual; no down-migration):
--   DROP INDEX IF EXISTS public.event_waitlist_event_email_unique;
