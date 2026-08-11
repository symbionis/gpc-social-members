---
title: "Cancelled seats reappear when counts derive from registration.quantity"
date: 2026-08-11
category: logic-errors
module: events
problem_type: logic_error
component: service_object
last_updated: 2026-08-11
symptoms:
  - "Admin overview reported 10 tickets sold when only 7 had been paid for; 3 comp guest-list seats counted as sold"
  - "Printed door sheet rendered 12 lines for 10 admissible people, padding cancelled seats back as blank \"to fill in\" rows"
  - "A booking refunded in full still printed as an arrivable party and rendered a card at the door console"
  - "Door console showed \"1 / 2 named\" with a slot no ticket row could satisfy"
  - "expected counted 12 against a 10-person roster; the surplus landed in unaccounted, the field meant to flag genuine data problems"
  - "After the first fix, a cancelled LEAD with a live guest was still rebuilt from the purchaser and printed as an admissible line"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - lib/events/ticket-admissibility.ts
  - lib/events/door-roster.ts
  - lib/events/door-access.ts
  - components/admin/EventRosterSummary.tsx
  - seats_used RPC
tags:
  - events
  - door-roster
  - cancellations
  - refunds
  - seat-counting
  - derived-data
  - single-source-of-truth
---

# Cancelled seats reappear when counts derive from registration.quantity

## Problem

An event in this codebase has two tables that describe the same people from different
angles. `event_registrations` is the booking: one row per purchase, carrying a
`quantity` — how many seats were bought. `tickets` is the seat: one row per person,
each with a nullable `cancellation_status`.

Every door-facing surface **lists PEOPLE from ticket rows** and **counts SEATS from
`registration.quantity`**. Cancel one ticket and the two halves stop describing the
same population: the row disappears from the list, but the quantity still counts it.
So any surface that pads to quantity, totals quantity, or reconciles a list against
quantity silently reinstates the cancelled person — even when its ticket query already
filters cancellations out.

Three roster surfaces had exactly this shape, each with its own hand-maintained copy of
the rule. All three were wrong in the same way, and the bugs surfaced together in one
session while building a demo event with 10 admissible tickets, 12 booked seats and
2 cancellations.

## Symptoms

**1. Admin overview reported comps as revenue.** The "Sold" panel summed
`registration.quantity` across paid *and* free registrations. A guest list in this
schema *is* a `free` registration (`event_registrations.is_guest_list`), so three
comped guest-list seats were counted as sold and the panel read 10 sold on an event
where 7 tickets had been paid for.

**2. The printed door sheet re-materialised refunded seats.** `lib/events/door-roster.ts`
already had `.is("cancellation_status", null)` on its tickets query — and was still
wrong, because the party loop pads each booking up to `registration.quantity`. The
cancelled seat came back as a blank "to fill in" line for staff to write a name on. A
booking refunded *in full* was worse: with no live ticket rows left it fell into the
reconstruct-the-lead-from-the-purchaser branch and printed as an arrivable party.

**3. The door console offered unfillable slots and cried wolf.** `lib/events/door-access.ts`
had the same query filter and the same raw quantity. A party read "1 / 2 named",
offering a slot no ticket row could satisfy; a fully refunded booking still rendered a
party card; and `expected` counted 12 against a 10-person roster. The surplus landed in
`unaccounted` — the field documented at `lib/events/door-access.ts:106-114` as the
signal that a party's rows and its quantity genuinely disagree. Ordinary refunds were
now setting off the alarm that exists to catch real data corruption.

**4. The first fix had the same bug one branch over.** Found by review, after the three
above were "fixed". The printed sheet's early-bail only covered a *fully* cancelled party
(`quantity === 0 && live.length === 0`). When the **lead** cancels and a guest is still
coming, the lead's row is partitioned out, so `leadTicket` is null and control falls into
the same reconstruct-from-purchaser branch — rebuilding the refunded buyer as a named,
tickable, `isLead` line. Two printed lines for one remaining seat, one of them a person who
had been refunded. The door console got this case right (its slots come only from ticket
rows), so the two surfaces had silently diverged again, which is the thing the shared rule
was extracted to prevent.

The shared helper was complicit: it reduced cancelled rows to a *count*, discarding which
row was cancelled — so the sheet could not tell "lead cancelled" from "lead never minted".
It now returns the cancelled rows as well.

## What Didn't Work

**Filtering in SQL.** All three surfaces already did this. It is necessary and
insufficient: dropping the cancelled rows in the query also drops the cancelled
*count*, and every caller then reaches for `registration.quantity` — which still
includes them. The filter that removes the person and the number that puts them back
were in the same function.

**Renaming the number.** The first instinct on the admin overview was to relabel
"Sold" → "Booked". The label was more honest, but the figure still swept comps into a
number people read as revenue. Renaming a wrong number does not make it right — the fix
was splitting the categories so the figures reconcile: `paid + free + guest list =
booked`, `booked − cancelled = active` (documented at
`components/admin/EventRosterSummary.tsx:23-31`).

**Consolidating the three roster builders — considered and rejected.** They look alike
and are not: only the printed sheet pads to seat count (paper needs a line per seat);
only the console synthesises fillable slots, which must map to a real `issued` row for
the fill RPC to flip; the admin roster synthesises nothing at all. One function with
three modes would have had no clear owner. Only the *rule* was extracted, not the
assembly.

## Solution

`lib/events/ticket-admissibility.ts` now owns the admissibility rule for all the roster
surfaces — the admin roster, the printed sheet and the door console import it
(`app/(admin)/admin/events/[id]/attendees/page.tsx:17-20`, `lib/events/door-roster.ts:2-6`,
`lib/events/door-access.ts:7-11`). Its runtime surface is three values and nothing else
(plus the types they need):

- `ADMISSIBLE_SLOT_STATUSES` — an allowlist of `["issued", "claimed"]`, deliberately
  *not* a negation of `claimed`: the DB check constraint still permits a legacy
  `unclaimed` value, and on a surface that governs admission an unrecognised status must
  fall off the roster rather than onto it as an anonymous tickable line.
- `partitionByCancellation` — returns `{ live, cancelled, cancelledByRegistration }`. The
  cancelled ROWS are kept, not just the tally: symptom 4 above is what happens when a
  surface can only ask "how many were cancelled" and needs to ask "was the lead one of
  them".
- `admissibleTicketsForRegistration` — `Math.max(0, (quantity ?? 0) - cancelled)`, floored
  because a booking with more cancellations than tickets is broken data and a negative
  would propagate into padding and headcounts. Named for tickets, not seats: both sides of
  that subtraction count ticket rows, and `registration.quantity` includes types that mint
  a ticket without consuming a seat.

Two load-bearing design decisions inside it:

**It returns BOTH halves, on purpose.** A caller handed only the live rows has no
cancelled count, falls back to `registration.quantity`, and reinstates the exact bug the
function exists to prevent. That is why the split happens in code rather than in the
query.

**An absent `cancellation_status` counts as live.** These surfaces govern door admission,
so an unreadable value must fail toward showing a real ticket-holder, never toward
silently emptying a door roster. The field is nonetheless declared *required*, so a
projection that forgets to select it fails to compile rather than failing open at a door —
the runtime coalesce is belt-and-braces for rows that arrive untyped. Note the deliberate
asymmetry: an unknown non-null status fails closed, a missing one fails open.

Each surface then uses the rule in its own shape. The sheet pads with
`admissibleTicketsForRegistration` instead of the raw quantity, refuses to rebuild a lead
whose own ticket was cancelled, and bails early on a fully cancelled
booking — `if (quantity === 0 && live.length === 0) continue;` — which is what stops the
purchaser-reconstruction branch from resurrecting a refunded party. The console filters
parties the same way and sums `expected` off the same helper. The admin page counts
seat-consuming *items* per registration and buckets them into paid / free / guest list,
taking `activeTickets` from the authoritative `seats_used` RPC and deriving the cancelled
count as `booked − active`.

Status: this work is on branch `symbionis/roster-summary-booked-label`, **PR #118, open
and not merged as of 2026-08-11**. Treat the fixes as pending until that PR lands.

## Why This Works

The bug was never "cancelled tickets leak through". It was that a single population —
the people who can walk through the door — was being derived twice, from two tables,
by three independently maintained code paths, and only one of the two derivations knew
about cancellation. Filtering harder in the query cannot fix that, because the query
only owns one of the two derivations.

Making the cancelled *tally* a first-class return value closes the gap structurally: the
information a caller needs to compute seats correctly arrives in the same call that
removes the rows, so there is no moment where the only number in scope is the wrong one.
And because only the rule moved — not the assembly — each surface keeps the behaviour
that genuinely differs (padding, slot synthesis, none) while being unable to disagree
about who is admissible.

## Prevention

**The smell to watch for:** any time a list of PEOPLE and a count of SEATS come from
different tables, they will drift the moment one row is cancelled, released, or archived.
Ask which of the two the code trusts, and whether the other one can still contradict it.
The same house rule already exists nearby for a different failure mode — never count off
a truncated read; `lib/events/seat-usage.ts` documents routing capacity counts through
Postgres RPCs precisely because a client-side sum silently under-counts past Supabase's
1000-row default.

**Fix, then extract, and let the tests prove it.** Each of the three defects was fixed
with its own pinning tests first (`lib/events/door-roster.test.ts` was created for the
sheet; the console cases were added to `lib/events/door-access.test.ts`), and only then
was the rule extracted. That refactor touched no existing test expectation — it added
`lib/events/ticket-admissibility.test.ts` and changed only source — so every door test
passed unchanged afterwards, which is what makes "behaviour-preserving" a claim rather
than a hope.

**"There are tests" and "the tests would catch this" are different claims — mutation
testing is what separates them.** A review of the fixes reverted each one and re-ran the
suite. The two door surfaces were genuinely pinned (seven mutations, all caught). The admin
overview was not: reverting the comps-into-paid bucketing, the seat-item counting, or the
cancelled-row filter each restored the original bug with the **entire suite still green**.
Its component test asserted the split *rendered* correctly; nothing asserted it was
*computed* correctly. The remedy was to move the derivation out of the server component —
which the repo does not unit-test — into a plain function (`lib/events/booked-tickets.ts`)
and test it there. If a surface cannot be tested where it lives, that is an argument for
moving the logic, not for trusting it.

**Two derivations of one population must share a fallback condition, not just a filter.**
Extracting the split surfaced a second divergence: the page fell back to
`registration.quantity` whenever no *seat-consuming* item was found, while `seats_used`
falls back only when a booking has **no items at all**. A merch-only booking therefore
counted its full quantity as seats in one derivation and zero in the other — and because
the overview shows `booked − active` as cancellations, the difference rendered as a refund
that never happened.

**Name the unit, not the intent.** The shared helper was called `seatsForRegistration` while
counting *tickets* (`registration.quantity` includes types that mint a ticket without taking
a seat). Both sides of its subtraction were tickets, so it was correct — but a reviewer
reasonably read it as a seats-vs-tickets unit mismatch and flagged it as a bug. Shipping the
wrong noun inside the very fix for a wrong-noun bug invites the next one; it is now
`admissibleTicketsForRegistration`.

**Write mocks that honour query filters.** A related near-miss in the same session: the
offer-token lookup's `.eq("event_id", eventId)` IDOR guard could be deleted with the
suite still green, because the test mock ignored `.eq`. Once the mock applied its
filters, deleting the guard failed two tests — verified by mutation. A mock that
swallows filters silently converts a security guard into decoration.

**Do not rename a wrong number.** If a figure is being read as something it does not
measure, changing the label preserves the wrong identity. Split it until the parts
reconcile, and show the reconciliation on screen — the overview now displays booked,
paid, free, cancelled and guest-list panels precisely so the arithmetic is checkable by
the person reading it.

**Keep the alarm honest.** `unaccounted` on the door console exists to make a genuine
rows-vs-quantity mismatch visible. Any change that routinely pushes ordinary business
events (a refund, a release) into that field destroys its value as a signal — an alarm
that fires on normal operations is one nobody reads.

## Related Issues

- [Releasing a seat without invalidating its ticket lets the holder still enter](./releasing-a-seat-without-invalidating-its-ticket-lets-the-holder-still-enter.md)
  — same root cause (a ticket-level state change with a consumer that never learns about
  it), different consumer and remedy. That doc prescribes guarding each call site
  individually; this one supersedes that approach with a single shared owner.
- [Registration-keyed door roster orphans imported attendees](../architecture-patterns/registration-keyed-door-roster-orphans-imported-attendees.md)
  — the padding rule it documents is what re-materialised the cancelled seats here.
- [Supabase row fetch undercount when aggregating](../database-issues/supabase-row-fetch-undercount-when-aggregating-2026-05-19.md)
  — the sibling "never count off a truncated read" rule referenced in Prevention.
- [Contact-only replay guard swallows people sharing an email](../database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md)
  — adjacent caution about deriving identity from the wrong key.
- Event refunds net out of finance as of 2026-08-10, and there is no Stripe webhook by
  the owner's choice, so a dashboard-side refund can desync silently (auto memory
  [claude]). That makes the roster the place a cancellation becomes visible at the door —
  reinforcing why `unaccounted` must not be polluted by ordinary refunds.
