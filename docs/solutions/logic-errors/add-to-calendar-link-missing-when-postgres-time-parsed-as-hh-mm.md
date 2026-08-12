---
title: "Add-to-calendar link silently absent because Postgres time is HH:MM:SS, not HH:MM"
date: 2026-08-12
category: logic-errors
module: events
problem_type: logic_error
component: service_object
severity: medium
root_cause: logic_error
resolution_type: code_fix
symptoms:
  - "\"Add to calendar\" link never rendered on the guest ticket manage page (/public/tickets/[token]) for any real event"
  - "No error and no console warning — the link was simply absent from the DOM"
  - "googleCalendarUrl() returned null because new Date(\"2026-08-10T18:30:00:00\") is Invalid Date"
  - "All-day events (start_time null) rendered fine, masking the failure"
  - "lib/events/calendar.test.ts stayed green because it only ever passed \"18:00\" / \"10:00\", a shape no DB row emits"
related_components:
  - lib/events/calendar.ts
  - lib/events/calendar.test.ts
  - components/public/TicketManager.tsx
  - "app/(checkin)/public/tickets/[token]/page.tsx"
  - lib/format.ts
  - lib/email/event-reminder.ts
  - events.start_time (Postgres time column)
tags:
  - events
  - add-to-calendar
  - date-parsing
  - postgres-time
  - test-fixtures
  - silent-null
  - guest-ticket-page
---

# Add-to-calendar link silently absent because Postgres time is HH:MM:SS, not HH:MM

## Problem

The "Add to calendar" link on the guest ticket manage page (`/public/tickets/[token]`) never rendered for any event that has a start time. The link-building helper returned `null` for every real database row, and the page quietly rendered nothing in its place.

## Symptoms

- On `/public/tickets/[token]`, the "Add to calendar" anchor was simply absent from the DOM for a timed event. Everything else on the page — title, date, location, ticket rows — rendered normally.
- **No error surfaced anywhere.** No thrown exception, no console warning, no server log line, no failing request, no red in CI. The failure mode was *silence*: a missing element, not a broken one.
- Because nothing signalled, the bug was found only by a human eyeballing the page during manual testing of the U6 receipt flow. Nothing in the automated stack would ever have raised a hand.
- All-day events (rows where `start_time` is `null`) rendered the link correctly, so the page never looked *uniformly* broken — which made the gap easy to read as "that event just doesn't have a link".

## What Didn't Work

The investigation was short but the path matters, because each hop looked innocuous:

1. `grep` for `calendar` surfaced two files: the helper `lib/events/calendar.ts` and its only UI consumer.
2. `components/public/TicketManager.tsx` gates the anchor on truthiness — `{calendarUrl && (<a href={calendarUrl} …>Add to calendar</a>)}`. Correct-looking React. It renders nothing when the URL is `null` and has no way to distinguish "no URL because there's nothing to link" from "no URL because the builder failed".
3. `app/(checkin)/public/tickets/[token]/page.tsx` passes `googleCalendarUrl({ … })` straight through as the `calendarUrl` prop. No branch, no logging, no fallback — a `null` from the helper travels intact to a conditional render and disappears.
4. `lib/events/calendar.ts` declares `googleCalendarUrl(event: CalendarEvent): string | null` and guards with `if (Number.isNaN(start.getTime())) return null;`. The guard was doing exactly what it was written to do. It was just being handed an unparseable string on every timed event.

**The green test suite was the real obstacle.** `lib/events/calendar.test.ts` had full-looking coverage — timed events, all-day events, multi-day all-day events, the description parameter, and even an explicit `returns null for an unusable start date` case. All passing. But every timed-event case passed a hand-written `"18:00"` or `"10:00"`: a two-part `HH:MM` string that **no row in the database ever produces**. The suite was green because it exercised an input shape the datastore does not emit.

Worse, the interface comment on `CalendarEvent.startTime` reads `// HH:MM[:SS] or null` — it advertised support for the three-part shape while the implementation could not parse it, and no test pinned that branch of the documented contract. The comment and the tests together produced confident-looking cover over the exact case that was broken.

**This was not an isolated escape on this branch (session history).** Every unit of the ticket-surface consolidation shipped with a green `npx vitest run` (1175 → 1207 tests) and a clean `tsc --noEmit`, and multiple real, user-visible defects still reached the preview — an invalid-phone silent save, a missing manage button, a buy-more capacity bypass. Each was found by a human clicking the page, not by the suite. Compounding the gap, in-app browser verification was unavailable for this whole window: `orca tab create` and `orca goto` failed with "Browser tabs are unavailable while a remote runtime is active", and disconnecting the saved remote environment, deleting it, and a full app restart all produced the identical error. The working substitutes were `curl` against the PR preview URL and asking a human to click through.

## Solution

The bug was one line. `lib/events/calendar.ts` built its ISO string by unconditionally appending `":00"` for seconds:

```ts
// BEFORE
const start = new Date(`${event.startDate}T${event.startTime ?? "00:00"}:00`);
```

The fix normalizes the time value to a full `HH:MM:SS` before interpolation, so either shape parses:

```ts
// AFTER
// Postgres `time` columns come back as "HH:MM:SS", but hand-entered values can be "HH:MM".
// Pad to full seconds so the ISO string we build parses either way.
function normalizeTime(time: string): string {
  const parts = time.split(":");
  return parts.length >= 3 ? parts.slice(0, 3).join(":") : `${parts[0] ?? "00"}:${parts[1] ?? "00"}:00`;
}
```

and the construction site becomes:

```ts
const start = new Date(`${event.startDate}T${normalizeTime(event.startTime ?? "00:00")}`);
```

The `":00"` suffix moves out of the template literal and into the normalizer, where it is applied only when seconds are actually missing.

A regression test pins the real database shape:

```ts
it("accepts the HH:MM:SS shape Postgres time columns actually return", () => {
  const url = googleCalendarUrl({
    title: "Pilates & Polo",
    startDate: "2026-08-10",
    startTime: "18:30:00",
    endDate: null,
    location: null,
    description: null,
  });
  expect(url).toContain("dates=20260810T183000%2F20260810T203000");
});
```

Opened on PR #130 and unmerged as of this writing.

## Why This Works

Two independent facts had to line up to produce an invisible failure.

**1. The data shape.** `events.start_time` is a Postgres `time` column. PostgREST serializes `time` as `HH:MM:SS` — verified directly against the live database, where the test event's `start_time` is `"18:30:00"`, not `"18:30"`. Appending `":00"` to that yields `"2026-08-10T18:30:00:00"`, which is not a valid ISO 8601 datetime. In plain Node:

```
new Date("2026-08-10T18:30:00" + ":00")  // Invalid Date
new Date("2026-08-10T18:30"    + ":00")  // Mon Aug 10 2026 18:30:00
```

The helper worked perfectly on the string the tests fed it and failed on every string the database produced. `normalizeTime` closes that gap by making the seconds component idempotent — present values pass through, absent ones get padded — so both shapes converge on a parseable ISO string.

**2. The null-return guard converted a data-shape mismatch into a no-op.** `googleCalendarUrl` returns `string | null` and guards with `if (Number.isNaN(start.getTime())) return null;`. That `null` is a *legitimate* value in this API — it also means "the start date is unusable, there is genuinely nothing to link". Downstream, `TicketManager.tsx` renders on truthiness, and truthiness cannot tell those two meanings apart. So a parse failure — an unambiguous bug — arrived at the UI wearing the same clothes as the intended empty case and was rendered as absence. There was no point in the chain where the two could be distinguished, which is exactly why nothing logged and nothing failed.

**Blast radius:** every timed event on the ticket manage page. All-day events took the `"00:00"` default from `event.startTime ?? "00:00"`, which is a two-part string that the old code appended `":00"` to correctly — so the all-day path always worked. That partial correctness is what let the bug survive: the feature demonstrably "worked" whenever anyone happened to check it against an all-day event.

**Sibling parsers were audited and are fine.** `formatStartTime` in `lib/format.ts` uses `time.slice(0, 5)` and the time-of-day helper in `lib/email/event-reminder.ts` uses `Number(startTime.slice(0, 2))` — both prefix-based, both tolerant of either shape. `calendar.ts` was the only consumer of `start_time` that reconstructed a full datetime string, and the only broken one.

## Prevention

The one-line fix is not the lesson. Three generalizable rules come out of this, and each of them would have caught it independently.

### 1. Test helpers against the shape the datastore actually emits, not a hand-written convenience shape

Every timed-event test in this file was written by hand as `"18:00"` because that is what a human types when they think "six o'clock". No row in the database has ever looked like that. A test fixture invented at the keyboard is a fixture of the *author's mental model* of the data, and that model is exactly what's wrong when a serialization-shape bug exists.

When a helper's input crosses a datastore boundary, derive at least one fixture from a real row and say so in the test name — the name is what stops a future contributor from "tidying" it back to the pretty shape:

```ts
// Good — the name is load-bearing; it explains why 18:30:00 and not 18:30
it("accepts the HH:MM:SS shape Postgres time columns actually return", () => { … });
```

Practical version of the rule: before writing fixtures for anything consuming a Postgres `time`, `timestamptz`, `numeric`, `date`, `json`, or array column, run one `select` against the real table and copy the serialized value.

This branch already paid for this lesson once (session history): `seed_lead_attendee`, the function that creates the payer's own ticket at checkout, inserted a `credential_token` but never a `manage_token`, because the migration that introduced per-ticket manage tokens patched only `mint_registration_tickets` and missed the second insert path. That left 26 live lead tickets with a null token, invisible until the surfaces were consolidated. The demo event was also seeded with a `manage_token` shaped differently from what real checkout produces. Same root shape: what the fixture creates is not what the database holds.

### 2. A nullable-return helper feeding a conditional render is a silent-failure pattern

`string | null` from the helper plus `{value && <…/>}` in the component is a mechanism for converting bugs into nothing. It fails closed, and failing closed is invisible.

**This exact pattern was found and fixed in this same component one day earlier (session history).** `components/common/PhoneInput.tsx` collapsed an unparseable phone number to the same `null`/`""` it uses for "left blank", so `TicketManager`'s `submit()` could not distinguish "user left it empty" from "user typed garbage" — it silently saved the blank and closed the panel. The fix added an explicit `onValidityChange` callback and gated `submit()` on it. That the same surface produced two structurally identical silent-null bugs in two days is the strongest argument here: this is a repo-level pattern, not a one-off.

Ask whether the `null` is really one thing. Here it was two: "unparseable input" (a bug) and "genuinely nothing to show" (fine). Options, roughly in order of cost:

- **Cheapest — log the bug case at the point where the two diverge.** The parse failure is not an expected condition; treat it as an anomaly:
  ```ts
  if (Number.isNaN(start.getTime())) {
    console.warn("[calendar] unparseable event start", { startDate: event.startDate, startTime: event.startTime });
    return null;
  }
  ```
  One log line would have turned a page a human had to notice into a searchable event.
- **Stronger — make the two outcomes different types**, so the caller must handle them separately: `{ ok: true, url } | { ok: false, reason: "unparseable" }`, or a distinct sentinel for the legitimate empty case. The conditional render then physically cannot swallow the error branch. This is the `onValidityChange` shape, generalized.
- **At minimum, assert on absence in the component test.** `TicketManager.test.tsx` passes `calendarUrl={null}` — that test proves the component tolerates `null`, which is genuinely useful, but it also means the *entire* rendered-link path had no coverage from either side. Pair the null case with a non-null case that asserts the anchor is present. Note the precedent: the phone fix added its regression tests where the silent value is *consumed* (`TicketManager.test.tsx`), not only where it is produced.

The general shape to be suspicious of: *a function that can return a falsy value for both "error" and "empty", consumed by a truthiness check.* Grep for that pattern rather than for this bug.

### 3. When an interface comment claims a set of accepted shapes, pin each one with a test

`// HH:MM[:SS] or null` documented three accepted inputs. Two were tested (`HH:MM`, `null`). The third — the only one the database actually produces — was not, and the implementation could not handle it. The comment was doing active harm: it gave a reader confidence that the `:SS` path was considered.

Treat a bracketed-optional or pipe-separated comment as a test checklist. Three documented shapes, three cases:

```ts
it.each([
  ["HH:MM (hand-entered)",  "18:30",    "20260810T183000%2F20260810T203000"],
  ["HH:MM:SS (Postgres)",   "18:30:00", "20260810T183000%2F20260810T203000"],
])("handles %s", (_label, startTime, expectedDates) => {
  const url = googleCalendarUrl({
    title: "X", startDate: "2026-08-10", startTime, endDate: null, location: null, description: null,
  });
  expect(url).toContain(`dates=${expectedDates}`);
});
```

(The `null` shape already has its own all-day case.) A table-driven test also makes the contract visible at review time: adding a shape to the comment without adding a row to the table becomes an obvious omission rather than an invisible one.

The meta-rule underneath all three: **a bug that produces no signal will be found by luck or not at all.** When a code path can fail into silence, the prevention work belongs at the point where the silence is created — the fixture, the null, the undertested contract — not at the eventual symptom.

## Related Issues

No GitHub issue tracks this; `gh issue list` returned nothing across searches for the calendar link, date/time parsing, and the ticket manage page. The fix is unmerged on PR #130.

Related learnings in this repo:

- [Adopt libphonenumber-js for E.164 phone normalization](../tooling-decisions/adopt-libphonenumber-js-for-e164-phone-normalization.md) — the closest structural sibling: hand-rolled normalization of an externally-shaped string that failed silently, for shapes the tests never used. **Caveat it against this doc:** it endorses "invalid input returns null, callers gate on it" as an unqualified good, which holds only because its callers *surface* the null. A null gated behind a render conditional, as here, is invisible.
- [Safari hydration mismatch from toLocale/formatToParts](../runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md) — the repo's other date/time rule and the reason `lib/format.ts` is the single date/time surface. It governs *rendering*; this doc governs *constructing* a Date from the split `start_date`/`start_time` columns.
- [PostHog sourcemap upload silently inert](../integration-issues/posthog-sourcemap-upload-silently-inert.md) — same failure signature one layer down: fully wired, green build, zero errors, completely inert because nothing asserted the output appeared.
- [Contact-only replay guard swallows people sharing an email](../database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md) — events-module silent bug whose tests passed because the fixtures encoded an assumption real data violates.
- [Reusing a nullable column as a value source](../architecture-patterns/reusing-nullable-column-as-value-source-trap.md) — events-module silent bug where an unchecked coercion produced a wrong-but-plausible value with no error.
- [Slot-based reminder scheduling](../design-patterns/slot-based-reminder-scheduling-2026-05-18.md) — the other events-module consumer of `start_date`/`start_time`; documents the wall-clock assumptions this link now shares.
- [A comment that justifies an omission is load-bearing](../best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md) — companion prevention rule for the undocumented input-shape claim the `return null` guard was making.
