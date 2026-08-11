---
title: A comment that justifies an omission is a load-bearing claim about another subsystem
date: 2026-08-11
category: best-practices
module: admin-finance
problem_type: best_practice
component: payments
severity: high
related_components:
  - database
  - documentation
applies_when:
  - "A comment explains why a field, column, or calculation is deliberately absent"
  - "The justification rests on a fact about a different subsystem (the DB does not record X, the API never returns Y)"
  - "A migration is about to add tracking for something an older comment says is not tracked"
  - "A figure is called revenue, collected, or net without a test pinning what it nets out"
  - "The app's own flags mirror an external system that a human has to keep in sync by hand"
symptoms:
  - "A dashboard figure is 2.4x the money actually collected"
  - "An accurate-when-written comment still asserts a constraint the schema no longer has"
  - "The subsystem that invalidated the claim has no link back to the file relying on it"
  - "Reading the DB flags naively still yields a wrong number, because those flags were never fully written"
  - "Only the external system can settle what the real figure is"
root_cause: inadequate_documentation
resolution_type: code_fix
tags:
  - comment-rot
  - load-bearing-comment
  - cross-module-invariant
  - refunds
  - stripe
  - revenue-reporting
  - reconciliation
---

# A comment that justifies an omission is a load-bearing claim about another subsystem

## Context

`lib/admin/finance.ts` reported event ticket revenue **gross of refunds**, and said so — in a comment explaining why the net column was deliberately absent (`git show 5f478c3:lib/admin/finance.ts`, lines 23 and 350):

```ts
//   - Event revenue      = sum of the ticket LINE ITEMS of `paid` registrations
//                          (gross; event refunds are not tracked in the DB).
```

```ts
// One Geneva calendar month of event ticket revenue. Gross only, with no `net`
// counterpart: event refunds are not recorded in the database, so a net column
// would just repeat gross and imply a reconciliation the data cannot support.
```

**The comment was true when written.** Event refunds genuinely were not in the database; the finance dashboard plan recorded the same constraint as an explicit non-goal, a data-model note, and a risk with a named mitigation.

Then different work made it false. The U14 cancellation migration (`supabase/migrations/20260722120000_ticket_cancellation.sql:20`) added `cancellation_status` to `tickets`, with `cancellation_requested_at` and `cancellation_refunded_at` alongside. From that moment the database *did* record which seats were refunded. Nobody revisited `lib/admin/finance.ts`. The comment stayed, and so did the omission it justified — for roughly nineteen days, until someone asked the right question.

For one event, the page reported **CHF 960** against **CHF 400** actually collected. CHF 560 of refunds were invisible. Nothing failed: no error, no alert, no red test. The number was simply wrong and looked fine.

**The second layer is what makes this worth writing down.** The obvious fix — sum the seats flagged `refunded` and subtract them — also produces a wrong answer, confidently. Only three seats had been marked, none carrying an amount, so the naive fix yields **CHF 720**: still wrong by CHF 320, now dressed in a `net` column. Refunds had been issued by hand in the Stripe dashboard while the in-app "mark refunded" step was optional, so it was skipped or half-applied. **Only Stripe was authoritative.**

## Guidance

**Lead principle: a comment justifying an *absence* is a claim about code you do not control, and it needs an owner or an executable check — never prose alone.**

**1. Recognise the shape.** `X isn't tracked` → *therefore* this code omits Y. When X changes, the comment is merely stale but the omission is a live defect — and the code around it looks deliberate, because it was. Descriptive comments rot visibly (a comment saying "sorts ascending" next to a descending sort is obviously wrong). Justifying comments rot invisibly: there is no code for a reviewer to look at, only code that isn't there.

**2. Prefer, in this order.** Make the absence visible in the type (`net: number | null` forces every consumer to acknowledge the gap; an absent field is indistinguishable from a design that never needed one) → write a test that fails when the claim becomes false → and only then settle for a comment.

The middle rung was the one missing here. This incident already had **eight** prose copies of the assumption — the file header, the interface doc comment, three passages in the plan (an explicit non-goal, a data-model note, and a risk row naming the caveat as its own mitigation), and caveat copy in three separate UI components — and all of them rotted simultaneously. A ninth would not have helped. **Prose does not survive a change in another subsystem; an executable check does.**

**3. If it must be a comment, make it falsifiable and greppable by the thing that would falsify it.** Name the table, name the falsifier, name the remedy. Then make the grep a migration-checklist step: *when a migration adds a column representing money or a money state transition, grep for assumptions naming that table before opening the PR.* The U14 migration would have hit `lib/admin/finance.ts` on the first grep — its own header already contained the sentence that killed the assumption ("an admin later marks it refunded manually"), written by someone with no reason to think about the finance page.

**4. Promote an assumption to a test when any of these hold:**

- The omission changes a number a human will act on (revenue, seat counts, payouts). A wrong number that renders cleanly is worse than a crash.
- The claim is about another subsystem's schema or behaviour — you do not control when it becomes false, and you will not be in the room when it does.
- The falsifier lives in a different file from the claim. Distance is the whole problem; a test is the only artifact that spans it.
- The claim justifies an absence rather than describing a presence.

**5. For money, reconcile against the payment provider, not the app's own flags.** The app's records are a *mirror*, and mirrors drift the moment a human step can be skipped. Verify a revenue figure against the provider the first time it is reported and whenever someone asks "is this real?". When backfilling from a provider, record the provider's object id (`stripe_refund_id`), so a later reconciliation is exact rather than by-amount guesswork.

**6. Treat an optional human mirroring step as a bug, not a workflow.** If the app records a fact a person must copy from another system, the two will disagree, and the disagreement will be silent and financial. Delete the step rather than documenting it more carefully: the refund route now issues the Stripe refund itself, so the record is a byproduct of the action instead of a chore that follows it.

**7. A caveat is not a control.** "Event revenue is gross of refunds" was on screen in three separate components, and in the plan's risk table as the named mitigation for exactly this risk. None of it stopped anyone reading CHF 960 as revenue — a number in a large font beats a disclaimer in a small one, every time. The plan also promised the same caveat on the CSV export; that one was never implemented, which only sharpens the point: the mitigation was prose, so its absence was as invisible as the defect it was meant to cover. If a figure is knowably wrong, either fix it or do not present it as the answer to the question people are asking. When a plan defers a correctness item behind a caveat, the deferral needs an owner and a trigger condition.

## Why This Matters

The cost here was a reporting number, which sounds survivable. Two things make it not.

**The error was invisible and self-confirming.** Every surface agreed — page, CSV export, and the app's own refund flags — because they all derived from the same wrong premise. There was no internal contradiction to notice. Catching it required leaving the system entirely and reading the payment provider.

**A wrong number that renders cleanly propagates.** Originator commissions are *not* currently computed from these figures — `aggregateOriginators` reads only membership `payments`, and the commission model was explicitly deferred — so the exposure was prospective rather than realised. But these figures are the intended input when that work lands, and an event-revenue figure overstated by 2.4x would have flowed into real payouts. That is the argument for fixing a reporting number while it is "only" a report.

The general form: **an omission justified by a fact about another subsystem is a distributed invariant with no owner.** The file asserting it cannot detect its own falsification, and the file that falsifies it has no reason to know the first exists.

## When to Apply

Apply this when writing, reviewing, or invalidating a cross-subsystem assumption:

- **Writing one** — you are about to explain why something is absent, and the reason lives in another module, another schema, or an external service.
- **Reviewing one** — a PR adds tracking, a column, a webhook, or a status for something previously untracked. Ask what elsewhere was built assuming it did not exist.
- **Trusting a figure** — anything labelled revenue, collected, net, or outstanding, especially the first time it is reported to someone who will act on it.
- **Inheriting a mirror** — the app stores its own copy of state owned by an external system, and a human keeps them in sync.

Not worth the ceremony for a comment describing local behaviour, or an absence whose justification lives in the same file where a reader will see both together.

## Examples

**The comment, before and after.** Before — recover it with `git show 5f478c3:lib/admin/finance.ts`, lines 349-351. No date, no named table, no reason for a future reader of `tickets` to think this file exists:

```ts
// One Geneva calendar month of event ticket revenue. Gross only, with no `net`
// counterpart: event refunds are not recorded in the database, so a net column
// would just repeat gross and imply a reconciliation the data cannot support.
```

After, as shipped — states the rule positively, records the incident that retired the old claim, and names the carve-out (`lib/admin/finance.ts:18-34`):

```ts
//   - Event refunds      = sum of the seats whose tickets are 'refunded'.
//   - Event net          = gross − refunds. THIS is event revenue; report it, not gross.
//
// Event refunds used to be absent from this file entirely, on the (then-true) grounds that the
// database did not record them. It does now — the admin roster issues the Stripe refund and
// writes the amount — and the gap was not academic: Pilates & Polo 3.0 reported CHF 960 of
// event revenue against CHF 400 actually collected, because CHF 560 of refunds had nowhere to
// be counted.
```

**A migration-time assertion, when the truth lives in the database.** The backfill states the number it verified and refuses to commit if reality has moved (`supabase/migrations/20260810204016_backfill_pilates3_refunds.sql:110`):

```sql
  IF v_total <> 560.00 OR v_seats <> 7 THEN
    RAISE EXCEPTION
      'Pilates & Polo 3.0 refund backfill mismatch: got CHF % over % seats, expected CHF 560.00 over 7',
      v_total, v_seats;
  END IF;
```

Nineteen lines converting "someone checked this once" into "this is still true, or the deploy stops."

**A test pinning the consequence rather than the mechanism.** `lib/admin/finance.test.ts` asserts that when only the `tickets` read fails, the summary reports `complete: false` *and* falls back to gross — encoding that a silent truncation of that table is exactly how refunds vanish again. An end-to-end case pins `eventGross`, `eventNet` and `totalRevenue` together, so no future change can restore gross to the headline without turning a test red. Verified by mutation: reverting `totalRevenue` to event gross fails a test, where before the change it passed.

**The fallback that makes old rows count.** `refundedAmountChf` prefers the amount recorded at refund time and derives the seat price when it is NULL — which is what makes seats refunded *before* refund accounting existed net out, instead of counting as full revenue forever.

## Related

- [Guard shared content as entity-specific](../design-patterns/guard-shared-content-as-entity-specific-2026-05-21.md) — the parent rule ("a stale in-code comment is an assumption, not a spec"). There the comment made someone *add* an over-built guard; here it made someone *omit* a column. Same rule, opposite direction, and the omission is harder to see.
- [Reusing a nullable column as a value source](../architecture-patterns/reusing-nullable-column-as-value-source-trap.md) — sibling silent-money bug in the events path, and the nearest precedent for distrusting a comment that declares a divergence deliberate.
- [Audit production before assuming a data migration](./audit-production-before-assuming-data-migration.md) — the audit-first discipline this work followed for the backfill, extended here: for money, audit the *payment provider*, not just the app DB. A read-only query over our own tables would have returned a confidently wrong number, because two of the four real refunds were misrecorded — one had no app record whatsoever, and another had only one of its three seats marked.
- [Releasing a seat without invalidating its ticket](../logic-errors/releasing-a-seat-without-invalidating-its-ticket-lets-the-holder-still-enter.md) — "enumerate every consumer of the freed resource". Finance was the consumer nobody enumerated when cancellation started freeing seats.
- [Supabase row-fetch undercount when aggregating](../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md) — prior instance of a finance aggregate silently reporting a wrong number, and why `getFinanceSummary` paginates.

Shipped across PRs #105–#111 (all merged to `main`). PR #105 carries the Stripe reconciliation table and the rotted-comment quote.

**Known residual, by decision:** there is no `charge.refunded` webhook. The safeguard against a refund issued in the Stripe dashboard is a process control — the team refunds through the admin only. If event revenue looks wrong again, that is the first hypothesis to test.
