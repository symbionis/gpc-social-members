---
title: "Admin lounge schedule cards reorder randomly on toggle"
date: 2026-04-02
status: resolved
severity: medium
component: admin/lounge
tags: [sorting, key-mismatch, server-component, router-refresh]
files:
  - app/(admin)/admin/lounge/page.tsx
  - components/admin/LoungeManager.tsx
---

# Admin Lounge Schedule Cards Reorder on Toggle

## Symptom

On the admin lounge schedule page (`/admin/lounge`), clicking the Open/Closed toggle on any session card caused all three cards (Wednesday PM, Saturday AM, Sunday AM) to randomly change order. The cards shuffled every time the toggle was clicked.

## Root Cause

The server component sorted lounge sessions using abbreviated day keys that didn't match the actual database column values:

```typescript
// Server component sort — BROKEN
const dayOrder: Record<string, number> = { wed: 0, sat: 1, sun: 2 };

const sorted = (sessions || []).sort(
  (a, b) => (dayOrder[a.day_of_week] ?? 99) - (dayOrder[b.day_of_week] ?? 99)
);
```

The `lounge_sessions.day_of_week` column stores full names (`wednesday`, `saturday`, `sunday`), not abbreviations. Since `dayOrder["wednesday"]` returns `undefined`, the fallback `?? 99` was applied to all three items, making them sort equally. JavaScript's `Array.sort` is not guaranteed to be stable when comparison returns 0, so the order was non-deterministic on each `router.refresh()`.

### Secondary Issues

1. **Admin name query**: Used non-existent `full_name` column — table has `first_name` and `last_name`
2. **Display labels**: Same abbreviated key mismatch in the client component's `dayLabels` map
3. **Time terminology**: "AM"/"PM" confused users — "Morning"/"Afternoon" preferred

## Solution

**Fix sort keys** in `app/(admin)/admin/lounge/page.tsx`:

```typescript
// BEFORE
const dayOrder: Record<string, number> = { wed: 0, sat: 1, sun: 2 };

// AFTER
const dayOrder: Record<string, number> = { wednesday: 0, saturday: 1, sunday: 2 };
```

**Fix admin name query** in the same file:

```typescript
// BEFORE
const { data: adminUsers } = await supabase
  .from("admin_users")
  .select("id, full_name");
adminMap[admin.id] = admin.full_name || "Unknown";

// AFTER
const { data: adminUsers } = await supabase
  .from("admin_users")
  .select("id, first_name, last_name");
adminMap[admin.id] = `${admin.first_name} ${admin.last_name}`;
```

**Fix display labels** in `components/admin/LoungeManager.tsx`:

```typescript
// BEFORE
const dayLabels = { wed: "Wednesday", sat: "Saturday", sun: "Sunday" };
const timeLabels = { am: "AM", pm: "PM" };

// AFTER
const dayLabels = { wednesday: "Wednesday", saturday: "Saturday", sunday: "Sunday" };
const timeLabels = { am: "Morning", pm: "Afternoon" };
```

## Prevention

- **Always verify lookup keys match actual DB values.** When building a sort or label map keyed on a database column, query the actual data first or check the table schema/seed SQL before writing abbreviated assumptions.
- **Test with `router.refresh()`** — sorting bugs only appear when server components re-execute, not on initial page load where insertion order may coincidentally match.
- **Use `ORDER BY` in SQL** instead of client-side sort where possible — Supabase supports custom ordering, which is more reliable than JavaScript sort with lookup maps.

## Related

- `docs/plans/2026-04-02-feat-events-calendar-and-lounge-status-plan.md` — feature plan containing the `lounge_sessions` schema
