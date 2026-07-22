---
title: "feat: Flat A–Z ordering for CSV export and printed door sheet"
date: 2026-07-22
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
plan_depth: standard
---

# feat: Flat A–Z ordering for CSV export and printed door sheet

## Summary

Both the admin attendee **CSV export** and the **printed door sheet** currently list
attendees **grouped by party, ordered A→Z by the lead's surname**, with each lead's
guests indented beneath them. A named guest is only alphabetised *within* their own
party, so finding a specific person at the door means first knowing who invited them.

This plan replaces that with a **single flat alphabetical list of every person**
(leads and named guests intermixed, sorted by surname across the whole event), so any
named attendee is found directly by name. Every row becomes self-sufficient — name,
ticket type, contact, booking ref, and party label ("lead" / "guest of X") show on
each row. Unnamed/padded tickets (blank check-off lines with no name) have nothing to
sort on, so they trail at the end grouped by booking ref, under a "To fill in" divider
on the printed sheet.

Both surfaces read the same builder (`lib/events/door-roster.ts`), so a single change
to the assembly/sort step covers both and they can never drift.

---

## Problem Frame

**Who is affected:** Door staff at check-in, and admins working the CSV backup roster.

**Current behaviour** (`lib/events/door-roster.ts`): rows are assembled into
`parties`, each party sorted internally as `[lead, ...namedGuests(A–Z), ...unnamed,
...padded]`, and the party array is sorted by the lead's surname
(`parties.sort(bySurname)`). The printed sheet (`DoorRosterSheet.tsx`) renders one
`<tbody>` per party with guests indented and contact/ref shown on the lead row only.

**The pain:** To tick off "Adams" at the door you must know Adams came in under
"Smith", then find the Smith block, then scan within it. There is no way to look a
person up by their own surname.

**The change the owner asked for:** *"csv export and door sheet should list all guests
in alphabetical order."* Confirmed interpretation (2026-07-22): a **truly flat A–Z of
every person**, leads and guests intermixed.

**Product-decision reversal — call this out explicitly.** This reverses a settled
decision from PR #71 (memory `project_pr71_attendee_export_roster`, decision #1):
*"Sheet indexes parties, not people (a lone guest is filed under their lead's
surname)… No second flat A–Z sheet."* The owner has now chosen the flat A–Z list over
that party-grouped model (option "Flat A–Z of every person", 2026-07-22). The decision
is intentional and current; this plan supersedes PR #71 decision #1.

---

## Requirements

- **R1** — Both the CSV export and the printed door sheet list every attendee in one
  flat alphabetical order by surname across the whole event; leads and named guests
  are intermixed (not grouped by party).
- **R2** — Every row is self-sufficient: name, ticket type, contact, booking ref, and
  party label ("lead", "guest of &lt;lead&gt;", or blank for an ops-imported attendee
  who belongs to no party) are all available on the row so a guest sorted far from their
  lead is still attributable and reachable.
- **R3** — Unnamed / padded tickets (no person named) are still emitted as one line
  each (preserving "no line = can't admit"), carry their booking ref and "guest of X"
  label, and sort to the end of the list grouped by booking ref.
- **R4** — Cancelled tickets keep their existing treatment (struck-through / `CANCELLED`
  on the sheet, `cancelled=yes` in the CSV) and are still excluded from catering totals.
- **R5** — Per-type catering totals (`rosterTypeTotals`) are unchanged in value; only
  the input shape they read (rows vs. parties) changes.
- **R6** — Scope is confined to the CSV export and the printed door sheet. The live
  Arrivals door console is **not** changed (see Scope Boundaries).

---

## Key Technical Decisions

**KTD1 — Flatten at assembly; extend the comparator with one `named` tiebreak.** Keep
every bit of the current per-party *row construction* (claimed-lead detection,
legacy-lead reconstruction from the purchaser, per-type padding via `typePool`, unnamed
lines, ops-imported one-person parties). Only the final assembly changes: instead of
pushing `{ sortKey, rows }` per party and sorting the party array, collect **all** rows
into one flat array and sort it.

`bySurname` already sends surname-less rows to the bottom and tiebreaks first-name then
`bookingRef`. That is *almost* enough, but it has a real hole: a **named one-word-name
person** (`last === ""`, `named === true` — e.g. a member recorded as "Madonna") is
surname-less too, so `bySurname` sorts them into the trailing block *among the blank
rows*, ordered by first name — and a blank row's empty first name sorts *before* a real
one. That would place a checked-in, ticketed guest below the "To fill in" divider
(KTD4), read as an unfilled line. So the flat sort needs **one added tiebreak**: within
surname-less rows, order `named === true` rows ahead of `named === false` rows. Concretely,
extend `bySurname` (or add a wrapping comparator over `RosterRow`) so the ordering is:
has-surname before surname-less; then within surname-less, named before unnamed; then
first name; then `bookingRef` (which clusters a booking's blanks together at the very
end). *Rationale:* the row data is already correct per row; this is a re-grouping plus a
one-clause tiebreak, so risk is contained to ordering — and the divider invariant ("all
named rows precede the first blank") holds for one-word names too.

**KTD2 — Change the return shape from `parties` to `rows`.** `DoorRosterResult` `ok`
variant becomes `{ status, event, rows: RosterRow[] }`. The `RosterParty` interface is
retired. `rosterTypeTotals` takes `rows: RosterRow[]` instead of `parties`. Three call
sites consume the old `parties` / `RosterParty` / `rosterTypeTotals(parties)` shape and
all change in this plan: the CSV route (`route.ts`, U2), the print page
(`app/(print)/print/door-roster/[id]/page.tsx`, U3), and the sheet component
(`DoorRosterSheet.tsx`, U3). *Rationale:* a flat list has no party objects; keeping a
one-party-per-row wrapper would be a misleading vestige.

**KTD3 — Make each printed row self-sufficient.** On the printed sheet, render contact
and booking ref on **every** row (drop the `lead ? … : ""` gate) and show the party
label from the existing `partyLead` field so the party link survives when a guest sorts
away from their lead. The party quantity (`tickets`) stays on the lead row only — it's a
party fact, shown wherever the lead sorts. The CSV already emits
`last_name/first_name/party_lead/email/phone/tickets` per row, so **no CSV column or data
change is required** beyond flat iteration.

*Layout decision (avoids re-widthing the fixed table):* the printed table is
`table-layout: fixed` with five columns whose widths already sum to the row. Do **not**
add a sixth column for the party label — render it as a **muted second line inside the
existing name cell** ("lead" or "guest of X" under the name), so the surname stays the
first thing the eye hits and no column widths need rebalancing.

*Contact is per-ticket, not inherited:* `rowFromTicket` populates `phone`/`email` from
the ticket's own captured contact, so a guest row shows that guest's own contact (blank
if none was captured) — it does not repeat the lead's number. Rendering contact on every
row therefore adds no duplicate-number clutter; blank contact cells are expected.

**KTD4 — Trailing "To fill in" block on the print sheet.** Because unnamed rows sort
last (KTD1), the printed sheet inserts a lightweight "To fill in" divider row before
the first nameless row, matching the preview the owner approved. The CSV needs no
divider — nameless rows are self-describing (blank name columns + `party_lead`) and
simply sort last.

**KTD5 — Out of scope: the live Arrivals console.** There are two `buildDoorRoster`
functions. This plan touches `lib/events/door-roster.ts` (CSV + print). The live
check-in console (`components/door/DoorConsole.tsx`, `app/(checkin)/door/[id]/page.tsx`)
uses a **separate** builder in `lib/events/door-access.ts` and is untouched.

---

## Approach (before → after ordering)

For an event with party **Smith** (lead Kai Smith + guests Jane Adams, Amir Brown, one
unnamed seat) and party **Brown** (lead Amir Brown, solo):

```
BEFORE  (parties A–Z by lead surname; guests within party)
  Brown, Amir      (lead, REF88)
  Smith, Kai       (lead, REF12)
    Adams, Jane    (guest of Kai Smith)
    Brown, Amir    (guest of Kai Smith)
    ______         (guest of Kai Smith, to fill in)

AFTER  (flat A–Z by surname; nameless rows trail)
  Adams, Jane   Std  +41…  REF12  guest of Kai Smith
  Brown, Amir   Std  +41…  REF12  guest of Kai Smith
  Brown, Amir   VIP  +41…  REF88  lead
  Smith, Kai    Std  +41…  REF12  lead
  ── To fill in ─────────────────────────────
  ______        Std        REF12  guest of Kai Smith
```

(The two "Brown, Amir" rows tie on surname and first name, so the comparator falls
through to `bookingRef` — REF12 before REF88 — putting the guest-of-Smith row above the
lead row.) The global sort produces the "AFTER" order directly; the trailing block is
the run of surname-less rows the comparator pushes to the end (named one-word names
ahead of the true blanks, per KTD1's `named` tiebreak).

---

## Implementation Units

### U1. Flatten roster assembly and sort in the shared builder

**Goal:** Produce one globally A–Z-sorted flat `rows` array instead of sorted parties,
and change the return/`rosterTypeTotals` shapes accordingly. This is the core change;
U2–U3 are consumer updates that follow from the new shape.

**Requirements:** R1, R2 (data availability), R3, R5.

**Dependencies:** none.

**Files:**
- `lib/events/door-roster.ts` (modify)
- `app/api/admin/events/[id]/attendees/route.test.ts` (ordering expectations — see U4;
  listed here because U1's behaviour is what these assert)

**Approach:**
- Replace the `parties: Array<{ sortKey; rows }>` accumulator with a flat
  `rows: RosterRow[]`. For each registration, `rows.push(leadRow, ...namedGuests,
  ...unnamedGuests, ...padded)` (the per-party construction blocks stay as-is). For
  ops-imported tickets, `rows.push(row)`.
- The per-party internal `.sort(bySurname)` on `namedGuests` becomes redundant once the
  whole array is sorted globally; remove it to avoid a misleading local sort.
- After collecting all rows, sort the whole array. Extend `bySurname` (or wrap it) with
  the `named` tiebreak from KTD1: has-surname before surname-less; then within
  surname-less, `named === true` before `named === false`; then first name; then
  `bookingRef`. This keeps a named one-word-name person above the blank rows (and thus
  above the "To fill in" divider), while still clustering a booking's blanks together at
  the end. Update `bySurname`'s param type to include `named` (or add the extra clause in
  the wrapping comparator).
- Change `DoorRosterResult` `ok` variant to `{ status: "ok"; event; rows: RosterRow[] }`.
  Remove the `RosterParty` interface and the `parties.map((p) => ({ rows: p.rows }))`
  wrapping at return.
- Change `rosterTypeTotals(parties: RosterParty[])` → `rosterTypeTotals(rows:
  RosterRow[])`, iterating rows directly (drop the outer `for (const p of parties)` /
  inner `for (const r of p.rows)` to a single `for (const r of rows)`). Value output
  is unchanged (still skips cancelled + empty titles, same sort).
- Update the file-header comment block (currently describes "grouped into parties and
  ordered by the lead's surname") to describe the flat A–Z model and the trailing
  nameless block.

**Patterns to follow:** the existing `bySurname` comparator and its documented
"nameless goes last" contract (`lib/events/door-roster.ts:70`); keep the allowlist
ticket query and legacy-lead reconstruction untouched.

**Execution note:** Behaviour-changing sort at the heart of the door sheet — update the
`route.test.ts` ordering assertions (U4) alongside this change so the new order is
proven, not assumed.

**Test scenarios** (asserted via U4's `route.test.ts` + optional `door-roster.test.ts`):
- Happy path: two parties whose members interleave alphabetically emit rows in one
  global surname order (e.g. Adams/Brown/Brown/Smith above), not clustered by party.
  *Covers R1.*
- A named guest sorts to their own surname position, not under their lead's surname.
  *Covers R1.*
- Every registration-backed row carries `bookingRef` and `partyLead` ("lead" or
  "guest of X"), including guest and padded rows; an ops-imported row carries neither
  (both blank) and that is expected. *Covers R2, R3.*
- **Ordering invariant:** every row *with a surname* sorts before every *surname-less*
  row; within the surname-less tail, `named` rows (one-word names) precede the blank
  rows; blanks sharing a `bookingRef` are adjacent. Include a fixture with a one-word
  name (`last === ""`, `named === true`) that asserts it sorts *above* the blanks, not
  among them. *Covers R3 and the KTD1 tiebreak.*
- An ops-imported ticket (no registration) files at its own surname among named rows,
  not at the end. *Covers R1.*
- `rosterTypeTotals(rows)` returns the same title/qty pairs (and same descending sort)
  as before the shape change, still excluding cancelled tickets. *Covers R4, R5.*

### U2. Iterate flat rows in the CSV export route

**Goal:** Emit the globally-sorted flat rows; no header/column change.

**Requirements:** R1, R2, R4.

**Dependencies:** U1.

**Files:**
- `app/api/admin/events/[id]/attendees/route.ts` (modify)

**Approach:**
- Replace `const { event, parties } = roster;` /
  `...parties.flatMap((p) => p.rows.map(emit))` with `const { event, rows } = roster;`
  / `...rows.map(emit)`.
- `HEADERS`, `emit`, `csvEscape` are unchanged — the CSV already carries `last_name`,
  `first_name`, `party_lead`, `email`, `phone`, `tickets` per row, so self-sufficiency
  (R2) is already satisfied for the CSV; only iteration and order change.
- Update the block comment (lines ~76–78) that describes the printed/spreadsheet views
  sharing the same *party* order to say they share the same *flat A–Z* order.

**Patterns to follow:** existing `csvEscape` formula-injection guard and the
fail-loud-on-error contract (`route.ts:100`) — unchanged.

**Test scenarios:** (covered in U4's `route.test.ts`) — the exported CSV rows appear in
global surname order with nameless rows last; header line unchanged; formula-injection
guard still applied.

### U3. Render the flat list on the printed door sheet

**Goal:** Render one flat, per-row-self-sufficient table with a "To fill in" divider
before the trailing nameless rows.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U1.

**Files:**
- `app/(print)/print/door-roster/[id]/page.tsx` (modify)
- `components/events/DoorRosterSheet.tsx` (modify)
- `app/(print)/print.css` (modify — divider styling; verify no party-grouping CSS is
  now dead)

**Approach:**
- `page.tsx`: destructure `roster.rows` (not `roster.parties`); pass `rows={roster.rows}`
  to `DoorRosterSheet`; call `rosterTypeTotals(roster.rows)`.
- `DoorRosterSheet.tsx`:
  - Props: `rows: RosterRow[]` instead of `parties: RosterParty[]`.
  - Recompute header counts from `rows` (`totalTickets = rows.length`,
    `named = rows.filter((r) => r.named).length`).
  - Replace the per-party `<tbody>` loop with a single `<tbody>` mapping `rows`. The
    per-party `<tbody>` page-break grouping is intentionally dropped (a flat list has
    no parties to keep together); apply `page-break-inside: avoid` per row instead so a
    single row never splits.
  - **Preserve the empty-state guard:** the current "No tickets sold" message is gated on
    `parties.length === 0` — change it to `rows.length === 0` so an event with no tickets
    still renders the message, not an empty table.
  - Render contact and booking ref on **every** row (remove the `lead ? … : ""` gates),
    and render the `partyLead` label as a **muted second line inside the name cell** (per
    KTD3 — "lead" or "guest of X"), so a guest remains attributable when sorted away from
    its lead without adding a sixth column. Keep `tickets` qty on the lead row only.
  - Insert a "To fill in" divider row immediately before the first row with
    `named === false` (rows are already ordered so all nameless rows are contiguous at
    the end, and the KTD1 tiebreak keeps named one-word names above them). Edge cases:
    if **no** nameless rows exist, no divider renders; if **every** row is nameless (an
    all-unnamed early-sales sheet), suppress the divider too — a "To fill in" header
    above a sheet of nothing-but-blanks reads as a mis-rendered section header. So render
    the divider only when there is at least one named row *and* at least one nameless row.
  - Keep the cancelled-row treatment (line-through + `CANCELLED —`) and the
    one-word-name fallback (surname-less prints the given first name) unchanged.
  - Update the component doc comment (describes "parties A→Z … guests indented") to the
    flat model.
- `print.css`:
  - **Remove guest-name indentation.** The current `.roster-guest .col-name`
    left-padding indents guests *under* their lead; on a flat A–Z sheet there is nothing
    to indent under, and any surviving indent breaks the single-left-edge surname scan
    the whole change exists to enable. All surnames — lead, guest, blank — must share one
    left edge; carry the lead/guest distinction by weight/colour only, not horizontal
    position.
  - **Keep the divider with its block.** Add `page-break-after: avoid` on the divider row
    (or wrap the trailing nameless run so it stays together) so the "To fill in" header
    never prints alone at the foot of a page with its blank lines orphaned onto the next.
  - Add the divider row style (full-width, `colspan` across all columns); audit
    `.roster-party`, `.roster-lead`, `.roster-guest` for any now-dead party-grouping rules.

**Patterns to follow:** existing `DoorRosterSheet` markup, tick-box column, and the
`.no-print` toolbar convention.

**Test scenarios** (new `components/events/DoorRosterSheet.test.tsx`, RTL + jsdom):
- Given mixed named + unnamed rows, the rendered table lists names in the order given
  (flat) and shows booking ref + contact on a guest row (not blank). *Covers R1, R2.*
- The "To fill in" divider renders exactly once, immediately before the first unnamed
  row, when the sheet has both named and unnamed rows. It does **not** render when every
  row is named, nor when every row is unnamed (all-blank sheet). *Covers R3.*
- The party label renders as a muted second line in the name cell — "lead" on a lead
  row, "guest of &lt;name&gt;" on a guest row. *Covers R2.*
- A cancelled row still shows the struck `CANCELLED —` treatment. *Covers R4.*
- An event with zero tickets renders the "No tickets sold" empty-state message, not an
  empty table (guard is `rows.length === 0`).
- Header counts (`N tickets · M named · K to fill in`) reflect the flat `rows` length.
- Test expectation note: purely presentational; no route/DB involved.

### U4. Update and extend tests for the flat ordering

**Goal:** Prove the new global ordering and per-row self-sufficiency; retire assertions
that encoded party grouping.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** U1, U2, U3.

**Files:**
- `app/api/admin/events/[id]/attendees/route.test.ts` (modify)
- `components/events/DoorRosterSheet.test.tsx` (create — see U3 scenarios)
- `lib/events/door-roster.test.ts` (optional create — see note)

**Approach:**
- Rewrite the ordering-dependent tests in `route.test.ts`:
  - "orders parties by the lead's surname, not by purchase time" (~line 254) → reframe as
    "orders all people by surname globally." **Note:** the existing Ace/Zimmer fixture
    cannot prove flattening — Zimmer's party sorts entirely after Ace's, so its rows come
    out `[Ace, …Ace guests, Zimmer]` under *both* the old party-grouped code and the new
    flat sort. Add a fixture that actually interleaves *across* parties: e.g. party
    "Smith" (lead) with guest "Adams", and party "Brown" (solo lead), expecting the flat
    order `[Adams, Brown, Smith]`. That expectation fails under the old grouped code and
    passes only under the flat sort. Keep Ace/Zimmer, if useful, only as a stability check.
  - "exports every ticket the party bought, named or not" (~line 169): the single-party
    fixture still emits all 5 rows, but the **order changes** — under a global surname
    sort the lead "Ann Leader" (last=Leader) sorts *after* guest "Bo Guest" (last=Guest),
    so `row[0]` becomes the guest and the lead (with the quantity/waiver/arrived
    assertions) moves to `row[1]`; the 3 blanks stay `rows[2..4]`. Recompute **all five**
    expected lines — do not assume `row[0]` is still the lead.
  - Legacy-party blank-line test (~line 305) and the ops-imported test (~line 417):
    recheck expected row order under the flat sort (ops-imported "Marsh before Zimmer"
    likely holds unchanged; verify).
  - Keep unchanged: header line assertion (headers don't change),
    formula-injection guard test, fail-loud-on-error tests.
- Add flat-specific cases: a guest whose surname sorts before their lead appears before
  the lead; every surname-bearing row precedes every surname-less row; a **named
  one-word name** sorts above the blank rows (not among them); blanks of one booking are
  adjacent.
- Create `DoorRosterSheet.test.tsx` per U3 scenarios.
- **Optional** `lib/events/door-roster.test.ts`: a focused unit test of `buildDoorRoster`
  ordering + `rosterTypeTotals(rows)` against a small mocked admin client (reuse the
  chainable-mock pattern from `route.test.ts`). Include only if the implementer prefers
  ordering coverage decoupled from the HTTP route; otherwise `route.test.ts` suffices.

**Execution note:** Run `npm run test:unit` and confirm the door-roster / attendees
suites are green before finishing.

**Test scenarios:** (this unit *is* the test work — scenarios enumerated in U1 and U3.)

---

## Scope Boundaries

**In scope:** ordering + per-row rendering for the admin attendee CSV export and the
printed door sheet, via `lib/events/door-roster.ts` and its two consumers.

**Out of scope (not changing):**
- The live **Arrivals door console** (`components/door/DoorConsole.tsx`,
  `app/(checkin)/door/[id]/page.tsx`, `lib/events/door-access.ts`) — a separate
  `buildDoorRoster` the owner's request does not name.
- CSV **columns/headers** — unchanged (the flat data is already present per row).
- Ticket/registration data model, minting, claiming, cancellation logic.
- Catering-total *values* (`rosterTypeTotals` output is unchanged; only its input shape).

### Deferred to Follow-Up Work

- Optional secondary grouping controls (e.g. a toggle between flat A–Z and the old
  party view). Not requested; the owner chose flat outright.

---

## Risks & Known Residuals

- **Reversal of a documented decision.** PR #71 deliberately chose party grouping so a
  lone guest files under their lead. The owner has explicitly overridden that for the
  flat A–Z list. After merge, update memory `project_pr71_attendee_export_roster`
  (decision #1 now superseded) so the record isn't self-contradictory.
- **Guests detached from their lead lose visual adjacency.** Mitigated by KTD3 (ref +
  contact + "guest of X" on every row) so any row is still attributable and reachable.
- **A group arriving together is now scattered across the sheet — accepted tradeoff.**
  The flat A–Z optimises *look up one person by their own surname* (the owner's goal) at
  the cost of *check in a whole party that arrives together*, whose rows now sit at
  separate surname positions (and whose unnamed seats trail at the very end). On a
  single-page sheet this is neutral-to-better; on a multi-page sheet, checking in a group
  means flipping between pages. This is the deliberate consequence of the owner's choice,
  recorded here as an accepted tradeoff — worth a look at the first real multi-page event
  to confirm individual-name lookup is the dominant door workflow (see Verification).
- **A named one-word name (surname-less) — handled.** The KTD1 `named` tiebreak sorts
  named one-word names above the blank rows and above the "To fill in" divider, so a
  ticketed guest is never rendered as an unfilled line. Covered by a U1/U4 fixture.
- **A fully-nameless *reconstructed lead* (rare legacy data).** If a legacy registration
  has no purchaser name *and* no linked member, its reconstructed lead row is
  `named === false` and carries the party `tickets` quantity — it would sink into the
  surname-less tail below the divider, a quantity-bearing "lead" row among the blanks.
  This needs a legacy reg with a null name, which practice has not produced. Accepted;
  add a verify case rather than special-casing. If it ever bites, the fix is the same
  `named`-tiebreak family (treat a labelled lead as named-for-sort).
- **Qty-on-lead-only legibility in a dispersed list — accepted.** With `tickets` on the
  lead row only and the lead now sorted by its own surname, a door person reconciling a
  party scans the alphabet to find its members and cannot verify the count against rows
  in view. Accepted as the cost of the flat model; the shared `bookingRef` on every row
  is the reconciliation handle.
- **Print pagination.** Dropping the per-party `<tbody>` removes party page-break
  grouping; a long flat table now breaks purely by row. Mitigated with
  `page-break-inside: avoid` per row, plus `page-break-after: avoid` on the divider (U3).
  Verify a multi-page sheet in print preview.

---

## Verification

- `npm run test:unit` passes, including the rewritten `route.test.ts` ordering cases and
  the new `DoorRosterSheet.test.tsx`.
- Manual: for a real event, the CSV opens with attendees in one A–Z surname order,
  nameless rows last; the printed sheet (`/print/door-roster/<id>`) shows the same order,
  ref + contact on every row, "guest of X"/"lead" labels, and a "To fill in" divider
  before the blank lines. Print preview shows clean multi-page breaks.
- The two surfaces list the same people in the same order (shared builder invariant).
- The live Arrivals console is visually unchanged.
- After the first real event on the new sheet, confirm with door staff that arrivals are
  looked up by *individual name* (which the flat sheet speeds) rather than by *host
  party* (which it slows) — the premise this change rests on. If lookup is by host, revisit
  whether the deferred flat-vs-grouped toggle is worth building.

## Definition of Done

- R1–R5 satisfied and covered by tests; R6 (Arrivals untouched) verified by the scope
  boundary and the manual check, not by a test.
- CSV export and printed door sheet both list all attendees in one flat A–Z order with
  self-sufficient rows and a trailing "To fill in" block.
- Arrivals console untouched; test suite green.
- Post-merge: memory note updated to record the superseded PR #71 decision.

## Sources

- `lib/events/door-roster.ts` — the shared builder (current party-grouped model).
- `app/api/admin/events/[id]/attendees/route.ts` + `route.test.ts` — CSV export.
- `app/(print)/print/door-roster/[id]/page.tsx`, `components/events/DoorRosterSheet.tsx`,
  `app/(print)/print.css` — printed sheet.
- `lib/events/door-access.ts` — the *separate* live-console builder (out of scope).
- Memory `project_pr71_attendee_export_roster` — the decision this plan supersedes.
- Owner decision, 2026-07-22: "Flat A–Z of every person".
