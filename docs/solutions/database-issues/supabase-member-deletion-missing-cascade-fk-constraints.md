---
title: "Supabase: Cannot Delete Member — Missing ON DELETE CASCADE on FK Constraints"
date: 2026-03-31
category: database-issues
component: database/members
technologies: [Supabase, PostgreSQL]
symptoms:
  - "Unable to delete row as it is currently referenced by a foreign key constraint"
  - Supabase dashboard shows FK violation when deleting from `members` table
  - "Key (id)=(...) is still referenced from table renewal_tokens"
related: []
---

# Supabase: Cannot Delete Member Row — Missing ON DELETE CASCADE

## Problem

Deleting a row from the `members` table in Supabase fails with:

```
Unable to delete row as it is currently referenced by a foreign key constraint
from the table `renewal_tokens`. DETAIL: Key (id)=(...) is still referenced from
table renewal_tokens.
```

## Root Cause

Five child tables reference `members.id` via foreign keys without `ON DELETE CASCADE`. Postgres refuses to delete a parent row that still has dependent child rows, to protect referential integrity.

## Affected Constraints

Discovered via:

```sql
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE rc.unique_constraint_name IN (
  SELECT constraint_name FROM information_schema.table_constraints
  WHERE table_name = 'members' AND constraint_type = 'PRIMARY KEY'
)
AND tc.constraint_type = 'FOREIGN KEY';
```

| Constraint | Table |
|------------|-------|
| `applications_member_id_fkey` | `applications` |
| `payments_member_id_fkey` | `payments` |
| `membership_cards_member_id_fkey` | `membership_cards` |
| `referrals_member_id_fkey` | `referrals` |
| `renewal_tokens_member_id_fkey` | `renewal_tokens` |

## Solution

Drop and re-add each constraint with `ON DELETE CASCADE` in the Supabase SQL editor:

```sql
ALTER TABLE applications
  DROP CONSTRAINT applications_member_id_fkey,
  ADD CONSTRAINT applications_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE payments
  DROP CONSTRAINT payments_member_id_fkey,
  ADD CONSTRAINT payments_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE membership_cards
  DROP CONSTRAINT membership_cards_member_id_fkey,
  ADD CONSTRAINT membership_cards_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE referrals
  DROP CONSTRAINT referrals_member_id_fkey,
  ADD CONSTRAINT referrals_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE renewal_tokens
  DROP CONSTRAINT renewal_tokens_member_id_fkey,
  ADD CONSTRAINT renewal_tokens_member_id_fkey
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
```

After applying, deleting a member cascades through all five tables automatically.

## Important Trade-offs

CASCADE is **permanent and irreversible**. Before using it in production:

| Scenario | Recommendation |
|----------|---------------|
| Deleting test/dev data | CASCADE is appropriate |
| Deleting real member data | Consider soft-delete (`deleted_at` timestamp) instead |
| Financial/payment records | `payments` may need to be retained for accounting — use `SET NULL` if so |

## Prevention: FK Convention for New Tables

When creating any new table that references `members.id`, explicitly declare cascade intent:

```sql
-- CASCADE: tokens are meaningless without the member
member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,

-- RESTRICT (default): retain payment records even if member is deleted
member_id UUID REFERENCES members(id) ON DELETE RESTRICT,
```

Never leave cascade behavior implicit — the Postgres default is `RESTRICT`, but this should be a conscious decision documented in the migration.
