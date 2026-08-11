---
title: "A registration-keyed door roster silently orphans any attendee without a registration"
date: "2026-07-11"
last_refreshed: "2026-08-11"
last_updated: "2026-07-11"
category: "architecture-patterns"
module: "events"
problem_type: "architecture_pattern"
component: "database"
severity: "high"
applies_when:
  - "Adding a new origin for attendees that does not create an event_registrations row"
  - "Writing tickets rows with a null registration_id"
  - "Building an admin surface that lists attendees and assuming the door console sees the same people"
  - "Projecting a derived feed (arrivals, counts) from the tickets table without the filter the parent projection applies"
related_components:
  - "door-console"
  - "admin"
tags:
  - "events"
  - "door-console"
  - "tickets"
  - "registrations"
  - "silent-bug"
  - "guest-list"
---

## The problem

`buildDoorRoster` in `lib/events/door-access.ts` builds the door console's entire roster from `event_registrations`, then hangs each party's `tickets` beneath it. A ticket with a null `registration_id` therefore belongs to no party and cannot be rendered — it does not exist as far as the door is concerned.

**There are two functions named `buildDoorRoster`:** this one (door console) and `lib/events/door-roster.ts:127` (printed sheet). They are separate implementations that handle orphans differently, and the name is not the identity — PR #111 fixed a cancelled-seat filter in one while the other kept listing seats the scanner already refused. Whenever you change one, state explicitly what you decided about the other.

The admin Import tab wrote exactly those rows. `import_event_attendees` inserted `claimed` tickets with no `registration_id`, so an admin could paste a hand-collected guest list, watch it appear correctly in the admin UI, and arrive at the event to find that none of those people were on the door. The failure was silent and only discovered at the gate.

The same trap bit a second time inside the door itself. The `arrivals` feed filtered on `checked_in_at` alone and never applied the null-registration skip that the `parties` projection applies, so a checked-in orphan ticket leaked into arrivals and inflated the arrived count — a derived feed drifting from its parent because the filter was re-implemented rather than shared.

## Why it happens

Two entities look interchangeable and are not. A **ticket** is the per-person record: name, credential, arrival. A **registration** is the party the door is keyed on. Code that only needs to record "this person is expected" reaches for `tickets`, because that is where the person lives — and a nullable `registration_id` invites it, since the column's own definition says the relationship is optional.

It is optional in the schema and mandatory in practice. Nothing enforces the invariant, and nothing fails loudly when it is broken.

## The fix

An attendee reaches the door by belonging to a registration, or not at all. The Guest list tab creates a real zero-price registration — lead, line items, minted tickets — so comp guests arrive through the same door path as paying ones and need no special handling anywhere downstream.

`import_event_attendees` remains in the schema for the legacy rows it created, but nothing calls it and the Import tab is gone. Those rows were left in place rather than backfilled; they stay invisible at the door, which is what they have always been.

## What to watch for

- Any new attendee origin that writes `tickets` without an `event_registrations` row is invisible at the door, however correct it looks in admin.
- Any derived projection over `tickets` — arrivals, counts, exports — must apply the same null-registration skip that `parties` applies, or it will drift from the roster it is supposed to describe. Share the filter; do not restate it.
- `expected` counts unnamed `issued` slots. Any list meant to reconcile against it must render open slots too, or the numbers will not add up. (It no longer sums raw registration quantities — see the cancellation note below.)
- **Orphans are now the ONLY divergence between the two builders, and it is deliberate.** They no longer restate `cancellation_status`, `released_at` and the `slot_status` allowlist in parallel — all three come from one shared rule (`lib/events/ticket-admissibility.ts`), which is this doc's "share the filter, do not restate it" advice actually taken. They still disagree on orphans: the printed sheet includes registration-less tickets on purpose, filing each under its own surname (`lib/events/door-roster.ts:440-443`), while the console skips them (`lib/events/door-access.ts:346-347`). The shared rule preserves the split rather than closing it — a cancelled ticket with no booking has no seat to subtract (`lib/events/ticket-admissibility.ts:87-89`). Know that before "fixing" either one to match the other.
- **"Expected" and the admin's live-seat figure now agree about cancellations.** Superseded 2026-08-11 (PR #118). This doc previously recorded the door computing `expected` as raw `sum(quantity)` while the admin used `seats_used`, and called the resulting overflow into `unaccounted` designed behaviour. It was not: a cancelled seat stayed in `expected` while every feed filtered it out, so ordinary refunds fired the alarm that exists to catch genuine data corruption. The door now nets each booking against its cancellations (`lib/events/door-access.ts:373`, via `admissibleTicketsForRegistration`). See [cancelled seats reappear when counts derive from registration.quantity](../logic-errors/cancelled-seats-reappear-when-counts-derive-from-registration-quantity.md).
- **`unaccounted` still exists, and is still worth protecting.** It surfaces a real rows-versus-quantity mismatch — a legacy party with no ticket rows, an `unclaimed` row filtered out of both feeds. What changed is that ordinary cancellations no longer land in it. Any change that routinely pushes normal business events back into that field destroys it as a signal.
