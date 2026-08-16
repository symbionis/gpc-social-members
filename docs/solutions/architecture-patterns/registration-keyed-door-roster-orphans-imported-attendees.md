---
title: "A registration-keyed door roster silently orphans legacy imports; registration-less tickets are now a category served by a second builder"
date: "2026-07-11"
last_refreshed: "2026-08-15"
last_updated: "2026-08-15"
category: "architecture-patterns"
module: "events"
problem_type: "architecture_pattern"
component: "database"
severity: "high"
applies_when:
  - "Changing either of the two functions named buildDoorRoster — the console's or the printed sheet's"
  - "Adding a surface that reaches tickets through event_registrations, which silently drops registration-less rows"
  - "Projecting a derived feed (arrivals, counts, exports) from the tickets table"
  - "Adding a new attendee origin and deciding whether it needs a registration behind it"
  - "Tempted to 'tidy up' guest-list guests by giving each one a registration"
related_components:
  - "door-console"
  - "door-roster-sheet"
  - "admin-attendees"
  - "guest-lists"
tags:
  - "events"
  - "door-console"
  - "tickets"
  - "registrations"
  - "guest-list"
  - "shared-rule"
  - "silent-bug"
---

## Context

`buildDoorRoster` in `lib/events/door-access.ts:202` builds the door console's roster from
`event_registrations`, then hangs each party's `tickets` beneath it. A ticket with a null
`registration_id` belongs to no party and cannot be rendered by that function — by
construction, not by a filter.

That used to mean "invisible at the door, full stop", and this doc used to prescribe the
cure: give every attendee a registration. **That prescription is retired, and following it
now would consume seats.** Under decision KD10 of
`docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md` a guest-list guest *is* a
ticket — `registration_id` null, `guest_list_id` set, `slot_status: 'issued'`, exactly one
row inserted (`lib/events/guest-lists.ts:347-358`). Capacity is derived from registrations
and their line items, so the **absence** of those rows is what keeps a guest-list guest out
of the seat count (KTD4). Writing a zero-price registration to "make the door work" would
silently start consuming capacity, which is the failure the old fix would now cause rather
than prevent.

The door problem was solved the other way instead: a second, deliberately independent read.
`buildNewGuestListGroups` (`lib/events/door-access.ts:412-421`, whose header comment carries
the rationale) walks guest-list tickets directly, and the console page awaits both builders
together — `await Promise.all([buildDoorRoster(id), buildNewGuestListGroups(id)])`
(`app/(checkin)/door/[id]/page.tsx:59`). The console renders the result in the same tab,
reusing `SlotRow`, so check-in behaves identically (`components/door/DoorConsole.tsx:65-77`).
The printed sheet covers them in its own flat list (`lib/events/door-roster.ts:475-484`).

Registration-less tickets are therefore a first-class category with two dedicated readers —
not an anomaly to be eliminated.

What is still genuinely orphaned is the **legacy ops-import** rows. `import_event_attendees`
inserted tickets with no `registration_id`; the RPC still exists in the database with no
caller (`lib/events/roster.ts:284-286`), the Import tab is gone, and those rows were left in
place rather than backfilled. The console skips them
(`lib/events/door-access.ts:344-347`); the sheet lists them. That divergence is real, still
silent, and still the only one between the two builders.

## Guidance

**There are two functions named `buildDoorRoster`.** One is the console's
(`lib/events/door-access.ts:202`), one is the printed sheet's (`lib/events/door-roster.ts:110`).
They are separate implementations. The name is not the identity — PR #111 fixed a
cancelled-seat filter in one while the other kept listing seats the scanner already refused.
Whenever you change one, state explicitly what you decided about the other.

**Share the filter; do not restate it.** Admissibility — `cancellation_status`, `released_at`,
and the `slot_status` allowlist — is owned by one module, `lib/events/ticket-admissibility.ts`,
imported by all three surfaces: `app/(admin)/admin/events/[id]/attendees/page.tsx:20`,
`lib/events/door-roster.ts:6`, `lib/events/door-access.ts:11`. It carries the split for
registration-less rows too: a cancelled ticket with no booking has no seat to subtract, so it
never enters the per-booking tally (`lib/events/ticket-admissibility.ts:87-89`).

**A derived projection over `tickets` must apply the rule its parent applies.** The arrivals
feed once filtered on `checked_in_at` alone and never applied the null-registration skip that
`parties` applies, so a checked-in orphan leaked into arrivals and inflated the arrived count.
The fix was to make both feeds walk the same party map in one loop
(`lib/events/door-access.ts:361-378`) — a single `if (!party) continue;` that both branches
inherit, rather than two filters kept in step by hand. Any new projection — counts, exports,
follow-up audiences — has the same obligation.

**Ask "does this read reach `tickets` through `event_registrations`?"** An inner join through
registrations drops registration-less rows *silently* rather than failing. That silent drop is
exactly what buys the capacity exclusion and exactly what breaks a total; which one you get
depends on whether the query is counting seats or listing people.

**`expected` counts unnamed `issued` slots.** An `issued` row is a minted ticket nobody has
named, and it goes into the not-arrived list as an open slot
(`lib/events/door-access.ts:372-377`), because `expected` sums each registration's
uncancelled seats (`lib/events/door-access.ts:389`). Any list meant to reconcile against that
number must render open slots too, or the arithmetic will not close.

**`unaccounted` is an alarm; keep ordinary business out of it.** It is
`expected − arrived − outstanding`, unclamped, and it exists to make a rows-versus-quantity
mismatch visible instead of absorbed (`lib/events/door-access.ts:121-131`). A legacy party
with no ticket rows, or a legacy `unclaimed` row filtered out of both feeds, belongs there.
Ordinary refunds do not — that regression was fixed by netting each booking against its
cancellations. Any change that routinely pushes normal events into this field destroys it as
a signal, because nobody reads an alarm that is always on.

## Why This Matters

Two entities look interchangeable and are not. A **ticket** is the per-person record: name,
credential, arrival. A **registration** is the booking the seat count is keyed on. The
nullable `registration_id` invites code that only needs "this person is expected" to write a
ticket and stop — and for years that produced people who were correct in admin and absent at
the gate, discovered only at the door.

KD10 does not abolish that hazard; it splits it in two. Null `registration_id` is now the
*deliberate, permanent* shape for one category of attendee, with named readers behind it. So
the question a change has to answer is no longer "does every ticket have a registration?" but
"**which** readers cover this ticket, and did I just add a fourth surface that covers none of
them?" A newly-nullable FK breaking its consumers is the general lesson, and it lives in the
sibling doc linked below.

## When to Apply

- Before editing either `buildDoorRoster`, or `buildNewGuestListGroups`, or the sheet's
  orphan loop — decide and record what happens to the other reader.
- When adding any surface that lists or counts attendees.
- When a review or refactor proposes giving guest-list guests a registration. It does not
  simplify the model; it starts consuming seats.

## Examples

The console's orphan skip and the two feeds it governs
(`lib/events/door-access.ts:344-347`, `:361-378`): one party lookup, both feeds inheriting the
same `continue`. The comment there is load-bearing — it records that the skip is also what
keeps `expected` reconciling.

The sheet's opposite choice (`lib/events/door-roster.ts:475-484`): registration-less tickets
are pushed into the flat list and file under their own surname among everyone else. Its
padding loop explicitly refuses to treat a guest-list ticket as a source of padding
(`lib/events/door-roster.ts:445-448`), because such a ticket is individually minted and never
counted in a registration's quantity.

Shipped across PRs #107/#108/#111 (exclusion across both door surfaces, shared rule extracted)
and #118 (cancellation netting). The KD10 model — registration-less guest-list tickets and the
second door builder — is on `symbionis/feat-unified-purchase-module`; PR **#136** is open and
unmerged as of 2026-08-15, so treat the guest-list half of this doc as describing the branch,
not production.

## Related

- [A nullish default turns a missing record into a confident false claim](../logic-errors/nullish-default-turns-a-missing-record-into-a-confident-false-claim.md)
  — owns the general lesson this doc no longer restates: how a column that becomes genuinely
  nullable breaks consumers that were written when it never was. There a registration-keyed
  `Map.get` with a defaulted fallback made a guest-list guest **mislabeled**; here a
  registration-keyed projection makes a legacy import **invisible**.
- [Cancelled seats reappear when counts derive from registration.quantity](../logic-errors/cancelled-seats-reappear-when-counts-derive-from-registration-quantity.md)
  — the padding rule documented here is what re-materialised its cancelled seats; it also
  carries the KD10 correction notes for the count side.
- [A content hash attests to the text, not the presentation](./a-content-hash-attests-to-the-text-not-the-presentation.md)
  — cites this doc for the two-builders shape: same trap, one subsystem over, under the same
  "share it; do not restate it" rule.
- [Releasing a seat without invalidating its ticket lets the holder still enter](../logic-errors/releasing-a-seat-without-invalidating-its-ticket-lets-the-holder-still-enter.md)
  — the ticket-level state change whose consumers this projection is one of.
- `docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md` — KD10 (a guest-list guest
  is a ticket with no registration), KTD4 (capacity exclusion is structural, not a filter),
  and U5 step 4, which spells out that adding a registration here would start consuming seats.
