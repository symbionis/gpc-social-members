-- Backfill referrals.converted_at so originator conversion counts stop reading zero.
--
-- THE BUG. `referrals` rows are written in exactly one place — the application
-- approve route (app/api/admin/applications/approve/route.ts) — and that insert
-- set only originator_id and member_id. `converted_at` has no column default and
-- nothing anywhere ever set it, while `status` sat at its 'pending' default
-- forever. The finance dashboard's originator breakdown counts conversions with
--
--     if (!r.converted_at) continue;          -- lib/admin/finance.ts
--
-- so every originator's "converted referrals" figure read 0, on every date range,
-- for the whole life of the feature. Confirmed against production before writing
-- this: 96 referral rows, 0 with converted_at, 96 with status 'pending'.
--
-- WHY created_at IS THE RIGHT VALUE. There is no earlier "pending referral"
-- record — no row is created at invite-link click or at application submission.
-- A row comes into existence at the moment an admin approves the application,
-- which is exactly the moment the referral converted. So for every existing row,
-- created_at already holds the conversion instant; this copies it into the column
-- that reporting reads. It invents no data.
--
-- The route now stamps both columns at insert (same commit), so this backfill is
-- one-time and covers only rows written before that change.
--
-- IDEMPOTENT: guarded on converted_at IS NULL, so a re-run is a no-op and a row
-- that legitimately gets a distinct conversion time later is never overwritten.

update public.referrals
   set converted_at = created_at,
       status = 'converted'
 where converted_at is null;
