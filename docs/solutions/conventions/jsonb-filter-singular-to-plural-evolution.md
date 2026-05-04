---
title: Evolving stored JSONB filter shapes from singular to plural without losing historical records
date: 2026-05-04
category: conventions
module: lib/broadcast
problem_type: convention
component: database
severity: low
applies_when:
  - "A persisted JSONB column stores a filter or audience snapshot that drives historical display (audit logs, sent broadcasts, exported reports)"
  - "Product feedback turns a single-value field into a multi-value field (one tier id -> many tier ids, one tag -> many tags, one segment -> many segments)"
  - "Older rows must remain readable and labelable forever — they cannot be retroactively re-shaped"
related_components:
  - service_object
  - rails_view
tags:
  - broadcasts
  - jsonb
  - audience-filter
  - backwards-compat
  - schema-evolution
  - convention
---

# Evolving stored JSONB filter shapes from singular to plural without losing historical records

## Context

Broadcasts persist their audience selection as a JSONB `audience_filter` blob on the `broadcasts` row at send time. The first cut accepted a single optional `tier_id`. When the product later needed multi-tier audiences, the obvious shape change was `tier_id: string | null` → `tier_ids: string[]`.

Because every previously-sent broadcast already has the singular form serialized into its row — and the listing/detail screens display "Active members · Player" by reading that blob — a hard cutover would have rendered "Active members · tier" (with the placeholder fallback) for every historical row, silently corrupting the audit trail.

This is a generic shape: any time a stored filter snapshot graduates from one-of to many-of, both the writer and the reader must accept both shapes — but only writers are migrated, never the data.

## Guidance

When evolving a JSONB-stored filter from a singular field to a plural one:

1. **Add the new plural field; never delete the old one from your read code.** New writers emit only the plural form. Old readers must accept either — they treat singular as a one-element plural.
2. **Normalize at parse time, in one place per surface.** The HTTP route and the display component each have their own "read either shape, normalize to array" step. Don't sprinkle conditional checks through downstream code.
3. **Update the resolver/query layer to use the plural primitive** (`.in("tier_id", ids)` instead of `.eq(...)`). The resolver doesn't care that legacy callers pass length-1 arrays.
4. **Don't backfill historical rows.** They are an audit record of what the filter said *at send time*. Rewriting them is both unnecessary and a small lie.
5. **Tighten the TS/contract type** to the new plural shape — but keep the parser-side legacy fallback as a `Pick<...>`-style widening only at the IO boundary (route handlers + display components), not in the canonical resolver type.

## Why This Matters

- **Audit integrity**: a broadcast row is supposed to record what was sent. Backfilling its `audience_filter` after the fact rewrites history.
- **Cheap forward path**: leaving legacy reads in place costs ~10 lines of fallback parsing and zero runtime cost; backfilling costs a migration, a one-shot script, and the operational risk of partial failures.
- **No coordination cost**: writers (UI + API) update on one deploy; readers (history pages) tolerate both shapes from that deploy onward. There is no "must deploy A before B" coupling.
- **Generalizes**: the same shape applies to multi-tag, multi-segment, multi-status filters next time a "make this multi" PR arrives.

## When to Apply

- Adding multi-select to anything previously single-select that gets serialized into a JSONB column.
- Renaming a stored field where old rows must still render with a meaningful label.
- Any audit/log/snapshot table where the row's purpose is to record state at a moment in time.

Do **not** apply this when the JSONB blob is purely transient state (e.g. a session-scoped cache) — there a hard cutover is fine.

## Examples

### Reader normalization at the IO boundary

API route — accept either shape, hand the resolver a clean array:

```ts
// app/api/admin/broadcasts/preview/route.ts
const tierIds: string[] = Array.isArray(filterRaw.tier_ids)
  ? filterRaw.tier_ids.filter(
      (id: unknown): id is string => typeof id === "string" && id.length > 0
    )
  : typeof filterRaw.tier_id === "string" && filterRaw.tier_id.length > 0
    ? [filterRaw.tier_id]
    : [];

const filter: AudienceFilter = { status, tier_ids: tierIds };
```

Display component — read either, render plural:

```ts
// components/admin/BroadcastList.tsx
const tierIds = filter.tier_ids && filter.tier_ids.length > 0
  ? filter.tier_ids
  : filter.tier_id
    ? [filter.tier_id]
    : [];
if (tierIds.length === 0) return statusLabel;
const names = tierIds.map((id) => tierMap[id] ?? "tier");
return `${statusLabel} · ${names.join(", ")}`;
```

### Canonical resolver type stays plural-only

The internal contract — the type the resolver consumes — has no legacy field. Legacy is a parser-side concept, not a domain concept:

```ts
// lib/broadcast/types.ts
export interface AudienceFilter {
  status: MemberStatus | "all";
  tier_ids?: string[] | null;  // plural only — legacy belongs at the edge
}
```

### Resolver uses the plural primitive

```ts
// lib/broadcast/audience.ts
const tierIds = (filter.tier_ids ?? []).filter((t) => t && t.length > 0);
if (tierIds.length > 0) {
  pageQuery = pageQuery.in("tier_id", tierIds);
}
```

A historical row that originally stored `{ "status": "active", "tier_id": "abc" }` is therefore:
- displayed correctly by `BroadcastList.tsx` (legacy fallback fires)
- never re-resolved (it's a sent record, not a live filter)
- never rewritten

## Related

- [docs/solutions/architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md](../architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md) — the broader broadcast pipeline this filter sits inside
