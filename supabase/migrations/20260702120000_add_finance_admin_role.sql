-- Add the `finance` admin role. Additive, non-destructive.
-- Postgres cannot USE a newly added enum value in the same transaction that
-- adds it, so this migration only adds the value; assigning it to an admin_user
-- is a separate data step (e.g. via the Users admin page or a follow-up UPDATE).
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'finance';
