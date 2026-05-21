---
title: "Don't guard shared content as if it were entity-specific"
date: 2026-05-21
category: design-patterns
module: events
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Shared content names a specific entity (an event, tenant, customer) but is reused across many of them"
  - "You are tempted to add an allowlist or ID guard (notFound/404/throw) to stop content showing for the 'wrong' entity"
  - "An in-code comment or a name implies a constraint no spec or product owner has confirmed"
  - "A source-of-truth value (date, name) is being duplicated into rendered content"
  - "The minimal correct fix looks like deleting code rather than adding enforcement"
tags:
  - shared-content
  - guard-clauses
  - source-of-truth
  - verify-intent
  - waiver
  - over-engineering
  - next-app-router
  - regression-test
related_components:
  - database
  - testing_framework
---

# Don't guard shared content as if it were entity-specific

## Context

A public door check-in feature (Next.js App Router + Supabase) shows attendees a bilingual (EN/FR) liability waiver before they enter an event. The waiver content lives in `lib/events/waiver.ts`, is rendered by `components/public/EventCheckInForm.tsx`, and each acceptance is recorded in `event_checkins` with `event_id`, a timestamp, and a content-derived `waiver_version`.

What started as a one-line date bug turned into an over-built guard. Three things stacked up:

1. **A duplicated source-of-truth value drifted.** The waiver subtitle hardcoded `"Open Doors Event – Thursday, May 22, 2026"`, but the event's DB `start_date` was `2026-05-21` — a *Thursday*. May 22 is a *Friday*. The legal document contradicted itself ("Thursday, May 22") because the date was typed into content instead of derived from the row.

2. **A stale in-code comment was treated as a spec.** The file carried `// EVENT-SPECIFIC … Do not silently reuse this waiver for a different event.` Acting on that comment, the first fix (PR #21) not only derived the date (good) but also added a hard guard:

   ```ts
   export const WAIVER_EVENT_ID = "d83759b3-36d1-4a78-8060-542d55c25cf3";
   export function hasWaiverForEvent(eventId: string): boolean {
     return eventId === WAIVER_EVENT_ID;
   }
   // in the check-in page:
   if (!hasWaiverForEvent(event.id)) notFound();
   ```

3. **The guard broke the real workflow.** The waiver was actually a *generic one-day visitor liability waiver* meant for every event. The guard turned "shows the wrong event name" into "404 for every other event" — scanning the Pilates & Polo QR code dead-ended. The owner's reaction: *"the waiver is the same for all events… Did you overcomplicate things?"*

The final fix (PR #24) deleted the guard, generalized clause 1 to name no specific event, dropped the event-specific subtitle entirely (the check-in header already renders event name + date from the DB), removed the now-orphaned date-formatting plumbing, and added a regression test asserting the waiver names no specific event. Net result: roughly 95 lines deleted, not added.

## Guidance

1. **When shared content *looks* entity/tenant-specific, verify product intent before gating it.** A document that happens to mention one entity's name is not proof it belongs to that entity. Confirm whether the content is meant to be shared, then prefer generalizing the content (remove the entity name) over adding a per-entity guard that restricts where it can be used.

2. **A stale in-code comment is an assumption, not a spec.** `// EVENT-SPECIFIC: do not reuse` described someone's past intent — possibly never true, possibly outdated. Comments aren't requirements. Confirm against actual product intent (here, the waiver was generic all along) before building enforcement around them.

3. **A guard that converts "wrong content" into "no access / 404" trades one failure for another.** Both are failures; pick the one the domain actually tolerates. Showing a slightly mis-titled waiver was recoverable; blocking every other event's entire check-in flow was not. Don't assume the louder failure (404) is the safer one.

4. **Don't duplicate a source-of-truth value into content — derive it, or better, don't render it twice.** The date already existed on the DB row and was already shown in the check-in header. Hardcoding it into the waiver subtitle created a second copy that drifted. The best fix wasn't "derive the date into the subtitle too" — it was deleting the subtitle's date entirely, since the header already showed it. One value, one place.

5. **The minimal change that matches intent often DELETES code.** The correct fix removed a constant, a function, a page guard, a type field, a prop, two date-formatting helpers, and their tests. When a fix keeps adding scaffolding (allowlists, guards, plumbing) to make wrong content "safe," that is a signal the *content* — not its access control — is what needs to change.

## Why This Matters

- **A generic document gated to one entity silently blocks everything else.** The waiver was valid for every event, but `hasWaiverForEvent()` returned `false` for all but one id, so every other event's check-in returned 404. Staff scanning a QR poster at the door would hit a dead end with no obvious cause — the feature looked "shipped" and passed its own tests while being broken for every real future event.

- **A duplicated value drifts into a self-contradicting artifact.** "Thursday, May 22, 2026" is internally inconsistent (May 22, 2026 is a Friday) and disagreed with the DB's 21-May Thursday row. For a *legal* document signed by attendees, a wrong date is not cosmetic — the signed waiver and the recorded `event_checkins` timestamp would reference different days.

- **Over-built guards calcify.** Once `WAIVER_EVENT_ID` + the 404 existed, every new event needed code changes (or a "parameterize per event" project) just to enable check-in — a permanent tax to protect against a problem that didn't exist.

## When to Apply

Reach for this thinking when you notice any of:

- **Shared content names a specific entity** (an event, tenant, customer, region) but is used across many of them.
- **You're tempted to add an allowlist or ID guard** (`if (id !== KNOWN_ID) notFound()` / 404 / throw) to "protect" content rather than fixing the content.
- **A code comment says "do not reuse" / "X-specific" / "do not edit"** and you're about to build logic that enforces it — confirm the claim against product intent first.
- **The same value is rendered in two places** (content + header, two templates, code + DB) and could disagree.
- **Multi-tenant / multi-event content** where one template is served to many contexts and each acceptance/record is already keyed by its own id + timestamp.

## Examples

**Clause 1 generalization (before → after):**

```ts
// Before (PR #21): names the specific event
"My presence as a spectator or participant at the Genève Polo Social Members Club Open Doors event implies awareness ..."
// After (PR #24): event-neutral
"My presence as a spectator or participant at a Genève Polo Social Members Club event implies awareness ..."

// FR, before → after
"... participant aux Portes Ouvertes du Genève Polo Social Club ..."
"... participant à un événement du Genève Polo Social Club ..."
```

**The guard, before vs after:**

```ts
// Before (PR #21) — waiver.ts
export const WAIVER_EVENT_ID = "d83759b3-36d1-4a78-8060-542d55c25cf3";
export function hasWaiverForEvent(eventId: string): boolean {
  return eventId === WAIVER_EVENT_ID;
}

// Before — check-in page
if (!event) notFound();
if (!hasWaiverForEvent(event.id)) notFound();   // 404s every other event

// After (PR #24) — both the constant/function and the page check are deleted.
if (!event) notFound();
// (no waiver gate; every published event serves check-in)
```

**The duplicated-date subtitle, removed entirely** (not "derived into the subtitle"):

```ts
// Before: a second copy of the date that drifted to a wrong weekday
subtitle: "Open Doors Event – Thursday, May 22, 2026",
// After: the `subtitle` field is removed from the Waiver type and content.
// The check-in header already renders event title + date from start_date.
```

**Regression test — assert no event name leaks back in** (it encodes the durable intent, "this content is generic," rather than the mechanism, so it survives later restructuring in either language):

```ts
it.each<WaiverLanguage>(["fr", "en"])(
  "does not name a specific event in the %s waiver",
  (lang) => {
    const w = getWaiver(lang);
    const text = [w.title, w.intro, ...w.clauses.flatMap((c) => [
      c.heading, ...c.paragraphs, ...(c.bullets ?? []), c.closing ?? "",
    ])].join(" ");
    expect(text).not.toMatch(/Open Doors|Portes Ouvertes/i);
  }
);
```

## Related

- [`design-patterns/slot-based-reminder-scheduling-2026-05-18.md`](./slot-based-reminder-scheduling-2026-05-18.md) — sibling instance of the same root cause. Its 2026-05-21 footnote ("send slot ≠ event time-of-day") is the same lesson: derive the descriptive value from its real source (the event's `start_time`) instead of borrowing/duplicating it.
- [`design-patterns/draft-row-claim-and-transition-2026-05-06.md`](./draft-row-claim-and-transition-2026-05-06.md) — useful **contrast**: a claim-or-404 guard is *correct* when the row is genuinely entity-scoped. The distinction is whether the thing being guarded is entity-specific (guard it) or generic content (generalize it).
- `docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md` — the origin plan for the door check-in feature this learning came from.
- Arc: PR #21 (`3f96751`, added guard + derived date) → PR #24 (`4a84065`, removed guard, generalized content, ~95 lines net deleted).
