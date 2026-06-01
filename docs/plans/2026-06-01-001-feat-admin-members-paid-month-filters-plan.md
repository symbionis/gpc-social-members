---
title: "feat: Paid-status and payment-month filters on admin members page"
type: feat
status: active
date: 2026-06-01
---

# feat: Paid-status and payment-month filters on admin members page

## Summary

Add two filters to the admin members list (`/admin/members`): a tri-state **paid-status** filter (All / Paid / Not paid) and a **payment-month** selector listing only months that actually have paid payments. Both stack (AND) with the existing search/status/tier filters and flow through the member count and CSV export. "Paid" and "payment month" are derived from the `payments` table — a member is paid when they have a `payment_status = 'paid'` row, and the month is the capture timestamp (`paid_at`, falling back to `created_at` when `paid_at` is unset) bucketed in Geneva time.

"Paid" here means *has ever paid*, not *paid up for the current season* — the filter is season-agnostic by design (the user asked for a calendar-month selector, not a season filter). See Risks & Dependencies for the consequences of this and of the refund/`paid_at` data realities surfaced during review; two of them are flagged for your confirmation before implementation.

---

## Problem Frame

The admin members page currently filters only on free-text search, member status, and tier. Admins have no way to answer two common operational questions: *who has paid?* and *who paid this month?* (e.g. for reconciliation against a bank statement or chasing unpaid renewals). Membership `status` is not a reliable proxy for payment — an `active` member could have a comped/honorary tier, and payment capture is tracked separately in the `payments` table, which project convention treats as the source of truth for financial records.

The existing page fetches all members server-side and filters them in-memory in the `MemberList` client component (`components/admin/MemberList.tsx`). This feature extends that same pattern rather than introducing server-side query filtering — it sources paid-payment data once on the server and hands the client a compact per-member map to filter against.

---

## Requirements

### Filtering behavior

- R1. The members list has a paid-status filter rendered as a select (All payments / Paid / Not paid). "Paid" shows members with at least one paid payment; "Not paid" shows members with none.
- R2. The members list has a payment-month selector listing only months that have at least one paid payment, newest-first, labelled like "May 2026". Selecting a month restricts the list to members with a paid payment captured in that month.
- R3. The paid-status filter, month selector, and existing search/status/tier filters all combine with AND.
- R4. The displayed member count and the CSV export both reflect the currently active filter set, including the two new filters.

### Data semantics

- R5. A member is "paid" iff they have a `payments` row with `payment_status = 'paid'` (any season). Payment month is bucketed to a calendar month in `Europe/Zurich` from `paid_at` when set, falling back to `created_at` when `paid_at` is null. R1 and R5 are deliberately equivalent: the `'paid'` row is the only condition for counting a member as paid; the timestamp is a property used for month bucketing, never a precondition. (The standard `checkout.session.completed` membership path writes `payment_status = 'paid'` without populating `paid_at`, so requiring a non-null `paid_at` would misclassify the majority of paying members as "Not paid" — see Risks & Dependencies.)
- R7. The paid-status filter is season-agnostic and refund-agnostic: it reflects whether a member has *ever* recorded a captured payment. It does not represent current-season standing, and it does not exclude payments later refunded out-of-band in Stripe (refunds do not write back to the `payments` table). These are documented limitations, not bugs — see Risks & Dependencies.
- R6. The server-side fetch of paid-payment rows is resilient to the Supabase 1000-row default response cap, so the paid/month data stays correct as payment volume grows across seasons.

---

## Key Technical Decisions

- **Aggregate paid-payment data server-side; filter client-side.** Keep `MemberList`'s in-memory filtering model. The server fetches paid payments once, reduces them to a `Record<member_id, string[]>` map of unique "YYYY-MM" month keys, and passes it as a new prop. The client derives both the paid flag (`months.length > 0`) and per-month membership from this map. Rationale: preserves the established page architecture, avoids the client doing payment joins, and keeps the payload small (one short string array per paying member, not full payment rows).

- **Bucket payment month in `Europe/Zurich`, not UTC.** Derive each month key via `Intl.DateTimeFormat` `formatToParts` pinned to `Europe/Zurich` (mirroring the existing `nowInZurich` helper in `lib/format.ts`), not a naive `.slice(0, 7)`. Rationale: a payment captured shortly after midnight UTC on the 1st belongs to the previous month in Geneva; UTC slicing would misfile it and disagree with every Geneva-time date already shown on the page.

- **Bucket on `paid_at` when present, else `created_at`.** The `checkout.session.completed` Stripe webhook path — the primary membership/renewal payment route — inserts the `payments` row with `payment_status = 'paid'` but does **not** set `paid_at` (only the deferred-capture `payment_intent.succeeded` path sets both). Requiring a non-null `paid_at` (the original plan) would have excluded the majority of genuinely-paid rows, marking those members "Not paid" and populating the month selector from the deferred-capture minority only. Resolution: count any `'paid'` row, and bucket its month on `paid_at ?? created_at`. Rationale: keeps the fix self-contained to this feature (no webhook change, no backfill migration) — the alternative (set `paid_at` on the checkout insert at `app/api/webhooks/stripe/route.ts` plus a backfill of existing rows) is broader and touches the payment write path, so it is held out unless you prefer true capture-time months over insert-time fallback for legacy rows. Trade-off: for checkout-path rows the displayed month reflects row-creation time, which is effectively capture time for that synchronous path — so the labels remain trustworthy as "the month the member paid."

- **Format month labels with a deterministic helper, never `toLocale*`.** Add `formatMonth("YYYY-MM")` to `lib/format.ts` built on the existing `MONTHS_LONG` array. Rationale: the month `<select>` renders during SSR (client components still SSR in App Router), and `docs/solutions/runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md` documents a recurring Safari React #418 hydration crash caused exactly by `toLocale*` separator divergence. Reassembling from a fixed array is byte-identical across runtimes.

- **Paginate the paid-payments fetch.** Read the paid rows in 1000-row ranges until exhausted. Rationale: project memory and the Supabase skill both flag the 1000-row default cap; payments accumulate every season, so a single unpaginated `select` will silently truncate and produce wrong paid/month results once the table crosses 1000 paid rows.

- **Extract the paid/month logic into a tested pure module.** Put month-key bucketing, the per-member map builder, available-month derivation, and the filter predicates in `lib/members/payments.ts` with a colocated Vitest test, following the repo's `lib/events/*.test.ts` convention. Rationale: the date-bucketing and filter-combination logic is the part most likely to harbour edge-case bugs (timezone boundaries, empty maps) and is far cheaper to test as pure functions than through the rendered component.

- **Tri-state paid filter and month picker as native `<select>`s.** Match the existing status/tier `<select>` markup and Tailwind classes in `MemberList`. Rationale: visual and interaction consistency with the three filters already on the page; no new dependency.

---

## Implementation Units

### U1. Paid-payment aggregation and month-label helpers

- **Goal:** Pure, tested functions that turn raw paid-payment rows into the per-member month map, the available-month list, and the filter predicates — plus a deterministic month-label formatter.
- **Requirements:** R1, R2, R5
- **Dependencies:** none
- **Files:**
  - `lib/members/payments.ts` (create)
  - `lib/members/payments.test.ts` (create)
  - `lib/format.ts` (modify — add `formatMonth`)
  - `lib/format.test.ts` (create — covers the new `formatMonth`; the module currently has no test)
- **Approach:**
  - `zurichMonthKey(iso: string): string` — bucket an ISO timestamp to `"YYYY-MM"` in `Europe/Zurich` using a module-level `Intl.DateTimeFormat` + `formatToParts` (same shape as `nowInZurich`). Reuse rather than reinvent the Zurich formatter pattern.
  - `buildPaidMonthsByMember(rows: { member_id: string; paid_at: string | null; created_at: string }[]): Record<string, string[]>` — group by `member_id`, map each row through `zurichMonthKey(paid_at ?? created_at)` (the `??` fallback handles the checkout-path rows that leave `paid_at` null — see the bucketing KTD), dedupe, sort descending. `created_at` is non-null on every row, so the key derivation never receives null.
  - `availablePaymentMonths(map: Record<string, string[]>): string[]` — union of all month keys across members, sorted descending. Drives the month `<select>` options.
  - `matchesPaidFilter(months: string[] | undefined, filter: "all" | "paid" | "unpaid"): boolean` and `matchesMonthFilter(months: string[] | undefined, month: "all" | string): boolean` — the two predicates the client ANDs into its existing filter chain.
  - `formatMonth(key: string): string` in `lib/format.ts` — split `"YYYY-MM"`, return `` `${MONTHS_LONG[m-1]} ${year}` `` (e.g. "May 2026"). No `Intl`, no timezone math — the key is already a calendar month.
- **Patterns to follow:** `lib/events/ticket-types.ts` + `lib/events/ticket-types.test.ts` (pure-module + colocated Vitest); `nowInZurich` / `zurichInstantToUtc` in `lib/format.ts` (Zurich `formatToParts` pattern); `MONTHS_LONG` already exported-internal in `lib/format.ts`.
- **Test scenarios:**
  - `zurichMonthKey`: a UTC instant of `2026-05-31T23:30:00Z` (which is `2026-06-01 01:30` Geneva, CEST) buckets to `"2026-06"`, not `"2026-05"` — proves Zurich bucketing, not UTC slicing.
  - `zurichMonthKey`: a winter instant `2026-01-31T23:30:00Z` (CET, +1) buckets to `"2026-02"` — proves DST-independent correctness.
  - `buildPaidMonthsByMember`: two paid rows for one member in the same Geneva month collapse to a single `"YYYY-MM"` entry; rows for different members stay separate; result months are sorted descending.
  - `buildPaidMonthsByMember`: a row with `paid_at: null` buckets by its `created_at` month (proves the checkout-path fallback); a row with both set buckets by `paid_at` (proves `paid_at` takes precedence over `created_at`).
  - `availablePaymentMonths`: union across members dedupes shared months and returns newest-first; empty map returns `[]`.
  - `matchesPaidFilter`: `"all"` matches any (including `undefined`); `"paid"` matches a non-empty array and rejects `undefined`/`[]`; `"unpaid"` is the inverse.
  - `matchesMonthFilter`: `"all"` matches any; a specific month matches only when present in the member's array; `undefined` months reject any specific month.
  - `formatMonth`: `"2026-05"` → `"May 2026"`; `"2026-12"` → `"December 2026"`.

### U2. Server-side paid-payment fetch on the members page

- **Goal:** Fetch paid payments (pagination-safe), build the per-member month map, and pass it to `MemberList`.
- **Requirements:** R5, R6
- **Dependencies:** U1
- **Files:**
  - `app/(admin)/admin/members/page.tsx` (modify)
- **Approach:**
  - Add a query against `payments` selecting `member_id, paid_at, created_at`, filtered `eq("payment_status", "paid")` (no `paid_at` null guard — checkout-path paid rows have null `paid_at` and must be counted; the month falls back to `created_at` in U1), run alongside the existing `members`/`tiers`/`originators` fetches.
  - Read in 1000-row ranges via `.range(from, from + 999)`, looping until a short page is returned, to clear the Supabase default cap (R6). Collect rows across pages.
  - Pass the rows through `buildPaidMonthsByMember` (U1) and hand the resulting map to `MemberList` as a new `paidMonthsByMember` prop.
- **Patterns to follow:** existing `createAdminClient()` + `.select().eq().order()` usage in this file; `MemberDetail`'s server-side payments read (`components/admin/MemberDetail.tsx`) for the `payments` column names.
- **Test scenarios:** `Test expectation: none -- thin data-fetching/wiring layer; the bucketing logic it calls is covered in U1 and the filter behavior in U3. Pagination correctness is verified manually against a >1000-paid-row dataset (or a temporarily lowered page size) per Verification below.`
- **Verification:** With the dev server running, `/admin/members` loads without error and the new month selector is populated from real payment data. Temporarily lowering the page size to 1 (then reverting) and confirming a member who paid across "pages" still appears under both their months demonstrates the pagination loop concatenates rather than truncates.

### U3. Paid and month filter controls in MemberList

- **Goal:** Render the two `<select>` controls and wire them into the existing filter pipeline, member count, and CSV export.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** U1, U2
- **Files:**
  - `components/admin/MemberList.tsx` (modify)
- **Approach:**
  - Accept the new `paidMonthsByMember: Record<string, string[]>` prop.
  - Add `paidFilter` (`"all" | "paid" | "unpaid"`, default `"all"`) and `monthFilter` (`"all" | string`, default `"all"`) state alongside the existing `search`/`statusFilter`/`tierFilter`.
  - Compute the month dropdown options with `availablePaymentMonths(paidMonthsByMember)` (U1), labelling each via `formatMonth` (U1); render two `<select>`s styled identically to the existing status/tier selects.
  - **Control labels and order.** Paid select: a leading `"all"` option labelled **All payments**, then **Paid** and **Not paid**. Month select: a leading `"all"` option labelled **All months**, then one option per available month newest-first. Insert the paid select immediately after the existing tier select, with the month select directly after it, before the Export CSV button — so the row reads search → status → tier → paid → month → Export.
  - **Empty month list.** When `availablePaymentMonths` returns `[]` (no captured payments anywhere yet), the month select renders with only the **All months** option — it stays visible and enabled but offers no month to pick. No special placeholder or disabled state.
  - Extend the `filtered` predicate (currently `matchesSearch && matchesStatus && matchesTier`) with `matchesPaidFilter(paidMonthsByMember[m.id], paidFilter)` and `matchesMonthFilter(paidMonthsByMember[m.id], monthFilter)`. Count (`filtered.length`) and CSV (`filtered.map(...)`) already derive from `filtered`, so R4 falls out for free.
  - **"Not paid" + a specific month** yields zero results (a member with no paid payment cannot have paid in a given month). Both selects stay independently enabled; the zero case renders through the existing path — the "N members" line shows `0 members` and the table body is empty, identical to any other zero-result filter combination. Do not disable either select or add bespoke messaging.
- **Patterns to follow:** the existing status/tier `<select>` blocks in `MemberList.tsx` (markup, Tailwind classes, `onChange` shape) and the existing `filtered` filter chain.
- **Test scenarios:**
  - Extract enough of the matching logic into U1's pure predicates that the component wiring is trivial; the behavior below is covered by U1's predicate tests, exercised here through the combined filter chain:
  - Covers R3. With paid=`"paid"` and a month selected, only members whose map contains that month appear; switching paid to `"all"` while keeping the month keeps the month constraint (month implies paid).
  - Covers R1. paid=`"unpaid"` shows exactly the members absent from `paidMonthsByMember` (or with an empty array).
  - Covers R3. A search term ANDs with paid+month — a paid member in the selected month whose name doesn't match the search is excluded.
  - Covers R4. After filtering, the rendered count and the CSV row set both equal the filtered list length.
  - Covers R2. The month select's options render newest-first (most recent month first) with `formatMonth` labels (e.g. "May 2026"), driven by `availablePaymentMonths`; with an empty `paidMonthsByMember` only the "All months" option is present.
- **Verification:** On `/admin/members`, toggling the paid select and choosing a month narrows the table and the "N members" count consistently; the month dropdown lists months newest-first and Export CSV downloads exactly the visible rows. Selecting "Not paid" plus a month shows `0 members` and an empty table. No console hydration warning (React #418) appears in Safari when the month options render.

---

## Scope Boundaries

- **In scope:** the two new filters, their server-side data sourcing, and their flow-through to count + CSV, all within the existing client-side-filtering architecture of `MemberList`.
- **Not goals:**
  - Converting the members page to server-side / URL-param filtering or pagination — the in-memory model stays.
  - Season-based filtering (the `payments.season` field) — the user asked for calendar month, not season. This makes "Paid" mean *ever paid* (see Risks); the month selector is the tool for "paid in a given period."
  - Changing how "paid" is determined anywhere else (member status logic, renewal flow, Stripe webhook), and changing the webhook to populate `paid_at` on the checkout path (the month fallback handles this without touching the payment write path).
  - Reconciling refunds — refunds are not recorded in the `payments` table (see Risks), so this filter cannot exclude them.
  - Adding a "paid months" column to the table or CSV — the filters already make the data reachable.

### Deferred to Follow-Up Work

- A dedicated "Payments" or reconciliation admin view (totals per month, amounts) is a larger, separate feature; this plan only adds list filters.

---

## Risks & Dependencies

- **`paid_at` is null on the primary payment path (handled in U1/U2).** The `checkout.session.completed` webhook writes `payment_status = 'paid'` without setting `paid_at` (verified in `app/api/webhooks/stripe/route.ts`; only the deferred-capture `payment_intent.succeeded` branch sets both). The original design required a non-null `paid_at`, which would have marked the majority of paying members "Not paid." Resolved by counting any `'paid'` row and bucketing the month on `paid_at ?? created_at`. Residual: for checkout-path rows the month label reflects row-creation time (≈ capture time for that synchronous path), not a distinct capture instant.
- **"Paid" is season-agnostic — confirm this matches intent.** Because season filtering is out of scope, a member who paid in a prior season but has *not* renewed for the current one still shows as "Paid" and is hidden from "Not paid." That is the cohort an admin chasing unpaid renewals wants to *find*, so the tri-state filter alone is a poor renewal-chasing tool — the month selector (pick the current season's months) is the intended workaround. If "Paid" should instead mean "paid up for the current season," season scoping must come back into scope. **Flagged for your decision.**
- **Refunds are invisible to this filter — confirm acceptable for reconciliation.** No code path writes `payment_status = 'refunded'` to the `payments` table; refunds are handled out-of-band in Stripe and only logged as `needs_refund` (`app/api/webhooks/stripe/route.ts`). A captured-then-refunded membership keeps `payment_status = 'paid'`, so it counts as "Paid" and appears under its original month. For bank-statement reconciliation this is a false positive that needs a manual Stripe cross-check. **Flagged for your decision.**
- **Supabase 1000-row cap (handled in U2).** An unpaginated paid-payments fetch would silently truncate once the table crosses 1000 paid rows, corrupting both filters with no error. The pagination loop in U2 is the mitigation and must not be dropped during implementation. (The members fetch on this page is also unpaginated and inherits the same cap independently of this feature — out of scope here, but worth tracking once membership crosses ~1000.)
- **Safari hydration (handled in U1).** Month labels must go through `formatMonth` / the `MONTHS_LONG` array, never `toLocaleString` — see the referenced solution doc. Reintroducing `toLocale*` here would resurrect a known production crash.
- **`payments` column names.** U2 depends on `payments.payment_status`, `payments.paid_at`, `payments.created_at`, and `payments.member_id` matching `types/database.ts`. Confirm against the generated types before querying (the project regenerates these; `payment_status` enum includes `'paid'`).
