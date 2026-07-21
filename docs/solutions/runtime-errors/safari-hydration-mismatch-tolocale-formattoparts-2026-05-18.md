---
title: "Safari React #418 hydration mismatch from toLocale* whitespace divergence"
date: 2026-05-18
category: runtime-errors
module: admin
problem_type: runtime_error
component: tooling
symptoms:
  - "Minified React error #418 (hydration mismatch) recurring in PostHog, Safari/macOS only"
  - "Same single user repeatedly tripped the error across multiple sessions over ~10 days"
  - "Visually identical date strings rendered, but byte-level different between SSR HTML and client hydration"
  - "PostHog stack trace blamed /admin/events, but the error actually fired on navigation to /admin/events/[id]/attendees"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - admin-events
  - admin-attendees
  - shared-formatters
tags:
  - hydration-mismatch
  - react-error-418
  - intl-datetimeformat
  - safari
  - nextjs-app-router
  - tolocalestring
  - u202f-narrow-nbsp
  - ssr-determinism
---

# Safari React #418 hydration mismatch from toLocale* whitespace divergence

## Problem

Admin pages crashed in Safari with React hydration error #418 because `Date.prototype.toLocaleString("en-GB", { hour, minute })` produced different whitespace bytes on the server (Node ICU: regular space `U+0020`) versus Safari WebKit ICU (narrow no-break space `U+202F`). Server-rendered HTML and client hydration output were visually identical but byte-different, so React's reconciler threw on every render of a date+time string in an SSR-rendered client component.

## Symptoms

- PostHog issue: `Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]=`
- Safari / macOS only — Chrome unaffected (Chrome's ICU matches Node's)
- 1-3 users impacted per occurrence, recurring for ~10 days; same single user kept tripping new instances
- Error fired on navigation to `/admin/events/[id]/attendees` (despite PostHog initially pointing the issue at `/admin/events`)
- Visually identical date strings rendered, but byte-level different between SSR and hydration

## What Didn't Work

1. **Patched the wrong file (commit `df0315f`).** PostHog flagged `/admin/events`, so we replaced `formatDate` in `components/admin/EventManager.tsx` with a hand-rolled `split('-')` formatter. The error came back the next day — that wasn't the component rendering at the error timestamp.

2. **Chased a stale-deployment theory.** Chunk hashes `4bd1b696-…` and `1255-…` in the stack trace looked unchanged across deploys, so we pushed an empty commit (`0facdf8`) to force Railway to rebuild and confirmed the new deployment was live. Error still appeared.

3. **Misread the chunk-hash diagnostic.** Those chunk hashes are React framework code, not application code. They don't change when `EventManager.tsx` changes. Their stability tells you nothing about whether your app code shipped — verifying via chunk hashes was an entirely wasted turn.

4. **Partial fix on one component (commit `565441b`).** Re-reading the PostHog session timeline carefully revealed:
   ```
   18:50:45  /admin/events
   18:50:47  Error  ← fires at this exact moment
   18:50:47  /admin/events/[id]/attendees  ← navigation completes
   ```
   The error fires *as* the user navigates to the attendees page, not on the events list. Patched `components/admin/AttendeeList.tsx` with a UTC-based hand-rolled formatter. This stopped the immediate error but left ~20 similar `toLocale*` calls across 11 admin components — every one a latent Safari hydration bomb.

## Solution

Introduced `lib/format.ts` as the single canonical formatter for SSR-safe date and currency rendering, and replaced all 20 ad-hoc call sites across 11 admin components (commit `11987d3`, net **-89 lines**).

**Before** (in many admin components — typical of `BroadcastList`, `AttendeeList`, `BroadcastDetail`, `LoungeManager`, `ScheduledJobsList`):

```tsx
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
```

**After** (`lib/format.ts`):

```tsx
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;

const GENEVA_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

function genevaParts(d: Date) {
  const out: Record<string, string> = {};
  for (const p of GENEVA_FMT.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value; // discard locale separators
  }
  return out;
}

export function formatDate(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = genevaParts(d);
  return `${parseInt(p.day, 10)} ${MONTHS[parseInt(p.month, 10) - 1]} ${p.year}`;
}

export function formatDateTime(
  input: string | Date | null | undefined,
  opts: { seconds?: boolean } = {},
): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = genevaParts(d);
  const time = opts.seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${parseInt(p.day, 10)} ${MONTHS[parseInt(p.month, 10) - 1]} ${p.year}, ${time}`;
}

export function formatCurrency(amount: number, opts: { decimals?: number } = {}): string {
  return `CHF ${amount.toFixed(opts.decimals ?? 0)}`;
}
```

Updated consumers: `EventManager`, `AttendeeList`, `BroadcastList`, `BroadcastDetail`, `BroadcastDraftsList`, `LoungeManager`, `TierManager`, `MemberDetail`, `MemberList`, `ScheduledJobsList`, `ApplicationQueue`.

## Why This Works

The `toLocale*` family delegates separator characters (the gap between `14:30` and surrounding text) to the runtime's ICU library. Node ICU and Safari ICU disagree for `en-GB` with time components — Node uses ASCII space (`U+0020`), Safari uses narrow no-break space (`U+202F`). React's hydration reconciler compares text nodes at byte level, so visually identical strings still trip error #418.

`Intl.DateTimeFormat.formatToParts()` returns structured parts tagged by `type` (`day`, `month`, `hour`, `literal`, etc.). By keeping only `type !== "literal"` parts, we discard every locale-controlled separator and reassemble the string ourselves with hard-coded ASCII characters. The output is now byte-identical across every JavaScript runtime.

Pinning `timeZone: "Europe/Zurich"` also eliminates the secondary mismatch where server (UTC on Railway) and client (Geneva, CET/CEST) computed different hour values when no timezone was specified.

## Prevention

**Rule:** Never call `Date.prototype.toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`, or `new Intl.NumberFormat(…).format` directly in any component that renders during SSR (server components or `"use client"` components — both SSR-render in App Router). Always use `lib/format.ts`.

**Anti-pattern** (latent Safari hydration bug):

```tsx
// In any SSR-rendered component
<span>{new Date(event.starts_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
```

**Correct pattern:**

```tsx
import { formatDateTime, formatCurrency } from "@/lib/format";

<span>{formatDateTime(event.starts_at)}</span>
<span>{formatCurrency(event.price)}</span>
```

**Safe exception:** client-only post-mount state (e.g. `BroadcastComposer.tsx`'s "Draft saved at HH:MM" timestamp set inside a save callback) never participates in SSR/hydration, so `toLocaleTimeString` there is harmless. The risk is strictly tied to values that are rendered during SSR.

**Debugging lessons baked in:**

- When PostHog reports a hydration error on path X, read the **Session timeline** — the error timestamp may coincide with navigation to path Y, and Y (the next page's component) is the real culprit.
- Chunk hashes in React error stack traces (`4bd1b696-…`, `1255-…`) are framework code. Their stability across deploys tells you nothing about whether your app code shipped. Verify deploys via known recent application changes or the Next.js build manifest, not framework chunk hashes.
- Hydration mismatches that only appear in **one browser** are almost always Intl/locale/timezone divergence between Node ICU and that browser's ICU. `grep -rn "toLocale\|new Intl\\." components/` before assuming anything else.

## Related Issues

- [`nextjs-dev-server-recompile-loop-playwright-mcp-2026-04-15.md`](../runtime-errors/nextjs-dev-server-recompile-loop-playwright-mcp-2026-04-15.md) — adjacent "hydration never completes" failure mode with a different root cause; useful for disambiguating hydration symptoms during triage.
- Commits: `df0315f` (wrong-file first fix), `565441b` (single-component real fix), `11987d3` (canonical refactor — current HEAD).
