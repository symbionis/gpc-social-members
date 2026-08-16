---
title: "A nullish default turns a missing record into a confident false claim"
date: "2026-08-15"
category: "logic-errors"
module: "events"
problem_type: "logic_error"
component: "rails_view"
symptoms:
  - "Guests added to an event guest list rendered a green \"Paid\" pill on the admin Attendees roster despite no payment ever being taken"
  - "The mislabel was uniform, not intermittent: every guest-list guest on every event was affected, because the fallback fired for all of them"
  - "The same row simultaneously showed \"Paid\" and a blank price, because the price field was computed by a correctly-guarded expression one line above"
  - "The identical collapse on the door console never lied, because nothing there reads the collapsed value — it was harmless by accident, not by a guard"
  - "No error, no log line, and no failing test — the wrong value was the reassuring one, so nothing mechanical flagged it"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "admin-attendees"
  - "door-console"
  - "registrations"
tags:
  - "events"
  - "guest-list"
  - "nullish-coalescing"
  - "default-values"
  - "silent-bug"
  - "nullable-column"
  - "data-modeling"
  - "admin-ui"
---

# A nullish default turns a missing record into a confident false claim

## Problem

On the admin event **Attendees** roster, every guest belonging to a *guest list* rendered a green **"Paid"** pill even though no money had changed hands. A single expression derived `paymentState` by collapsing a null `registration_id` into `""`, then defaulting the failed map lookup to `"paid"` — so any ticket with no booking behind it was confidently reported as paid.

## Symptoms

- The owner created a guest list on an event, added two guests (Frank and Simon), opened **Admin → Events → [event] → Attendees**, and saw both rows carrying the emerald **"Paid"** pill.
- No payment existed for either guest — a guest-list guest never passes through checkout, so there is no `event_registrations` row, no Stripe charge, and nothing in the payments table.
- The mislabel was **uniform**, not intermittent: *every* guest-list guest on *every* event showed Paid. There was no "sometimes" to chase.
- Nothing else on the row corroborated the pill. The per-seat price line directly beneath the ticket type rendered nothing (correctly), because that field was computed by a different, correctly-guarded expression — `priceChf: a.registration_id ? ticketRefundValueChf(…) : 0` at `app/(admin)/admin/events/[id]/attendees/page.tsx:258`. So one row simultaneously said "Paid" and "no price", ten lines of source apart.
- Type checking, lint, and the full unit suite were all green the entire time. Nothing mechanical flagged it. It was found by a human looking at the screen.

## What Didn't Work

There is no long debugging story here, and pretending otherwise would bury the actual lesson. Once the owner reported "these two guests say Paid", the cause was found by reading the one expression that produces `paymentState`. Total investigation: one file, one line.

The useful failures are the ones *before* the report. There are two, and the first is the more surprising.

### The risk register named this hazard, rated it highest, and it leaked anyway

This was not an unforeseen consequence. The implementation plan for the very feature that introduced the shape called it out explicitly, at `docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md:536`:

> **A guest-list ticket is a ticket no code has ever seen.** Verified against the shared database on 2026-08-15: `select count(*) from tickets where registration_id is null` returns **0**. The column is nullable but has never been null in production, so every query, join and count touching `tickets` has only ever run against rows that have a registration — none of them is tested or exercised against this shape, and an inner join through registrations will silently drop these rows rather than fail. […] `splitBookedTickets` is the known case and U9 owns it; the door roster projection is the suspected case and U6 checks it first. Mitigation: treat "does this read reach tickets through registrations?" as the standing question for every surface this plan touches, and grep `registration_id` before assuming a query returns them. **This is the single highest-risk consequence of KD10.**

Every part of that worked except the outcome. The hazard was identified in advance. It was rated the single highest-risk consequence of the decision. The mitigation named was the correct one — grep `registration_id`. Two affected sites were enumerated, and **both were in fact handled**: `splitBookedTickets` under U9, the door roster projection under U6. The plan even restated the shape at its origin, where U5 step 4 specifies inserting a guest with `registration_id` **null** (`plan:381`), and KTD4 explains that this very absence is what buys capacity exclusion (`plan:237`).

The attendees-page `paymentState` derivation was a **third site nobody enumerated**, and the grep sweep the mitigation asked for was never mechanically run across all consumers. It stayed a standing question people were trusted to remember rather than a command someone executed and read the output of.

**The non-obvious part: the plan predicted the wrong failure mode.**

It anticipated silent **omission** — "an inner join through registrations will silently drop these rows rather than fail." That is a precise and correct prediction about joins, and it is why the two enumerated sites were both *count/projection* sites. What actually happened was silent **mislabeling**: the guest-list row was present, rendered, sorted, and grouped perfectly well — one *attribute* of it was filled in by a default.

Those two shapes need different searches. Someone auditing for "does this read drop the row?" scans joins, `WHERE` clauses, filters, and aggregates. That audit will not stop on a `?? "paid"` applied to an attribute of a row already in hand — there is no join there to inspect, and the row is not going anywhere. The enumeration missed the site because the mental model of the hazard was *"rows disappear"*, and this site's failure was *"row stays, attribute lies."*

This is worth stating without blame, because nobody was careless: the site list was written by the same people holding the same mental model that created the hazard, and **enumeration-by-recall does not enumerate**. A risk register can name a hazard perfectly and still hand you an incomplete list of where it lands, because listing is a recall task and recall is bounded by the shape you have in your head. The mitigation was written to be mechanical (*grep* `registration_id`) precisely because someone sensed that — and the mechanical step is the part that did not get run.

### The safety net had exactly the same blind spot as the code

The roster component's unit suite passed continuously, including through a dedicated `describe("payment pill")` block that asserted a paid seat rendered "Paid" and a free seat rendered nothing. It passed because of its fixture factory (`components/admin/AttendeeList.test.tsx:17`, with the hard-coded id at `:21`):

```ts
function ticket(overrides: Partial<Attendee> = {}): Attendee {
  seq += 1;
  return {
    id: `t-${seq}`,
    registrationId: "r1",     // ← every fixture, always, no override in any test
    ...
  };
}
```

Every attendee fixture in the file hard-coded a registration id. Not one test ever constructed a registration-less attendee. The fixture set encoded the *same dead invariant* the buggy default encoded — "every ticket belongs to a booking" — so the tests could only ever exercise the branch that worked. A green suite was evidence about the fixtures, not about the code.

A `registrationId: null` value does appear elsewhere in the suite — `lib/events/checkin.test.ts:185` — but it is worth being accurate about what that is, because it is tempting to read it as prior coverage. It is the *expected return value* of an idempotency test, and the null arises only incidentally, because that fixture omits `registration_id` where the file's other fixture (`:74`) sets it. Nobody had written a deliberate registration-less-guest test anywhere. The shape had appeared by accident, never on purpose — which is a good reminder that grepping for a value is not the same as finding coverage of the case that value represents.

Two other things that would *not* have caught it, worth stating so nobody reaches for them next time:

- **TypeScript.** `a.registration_id ?? ""` is perfectly well-typed. `??` exists precisely to turn `string | null` into `string`, and the compiler is satisfied the moment the null is gone. The type system was never going to object to a valid coercion into a semantically meaningless value.
- **Code review of the diff that introduced guest lists.** The guest-list work added rows with `registration_id: null`; it did not touch this derivation. The bug was created at a distance — new data shape meets old assumption in a file nobody edited.

## Solution

Fixed on branch `symbionis/feat-unified-purchase-module` in two steps (PR #136, unmerged as of this writing).

> **On the SHAs below.** `15ec365` and `dc91e71` are pre-merge, in-branch provenance only. This repo squash-merges, so both will be rewritten into a single commit when #136 lands and will not resolve afterwards — **PR #136 is the durable reference**. They are kept because the two-step sequence is part of the lesson, and the intermediate state is not recoverable from the squashed commit.

### Step 1 — correct the default (`15ec365`)

Before, at `app/(admin)/admin/events/[id]/attendees/page.tsx:268` as it stood at `15ec365~1`:

```ts
paymentState:
  (regForRefundById.get(a.registration_id ?? "")?.status ?? "paid") === "free"
    ? ("free" as const)
    : ("paid" as const),
```

After:

```ts
// A guest-list ticket (KD10) has no registration_id at all — it never went through
// checkout, so there is nothing to default to "paid" against. The old `?? "paid"`
// fallback assumed every registration-less row was still paid, which was true before
// guest lists existed; now it mislabels every guest-list guest. Only a resolvable
// registration with a non-"free" status is "paid" — everything else, including no
// registration at all, is "free".
paymentState:
  a.registration_id && regForRefundById.get(a.registration_id)?.status !== "free"
    ? ("paid" as const)
    : ("free" as const),
```

The shape change is the point. The original *derived free from paid* — it defaulted to paid and demoted to free only on positive evidence of `status === "free"`. The fix *derives paid from evidence* — a row is paid only when it has a registration id **and** that id resolves **and** the resolved status is not `free`. Absence of evidence now lands on `free`, which renders nothing.

Note that this makes the derivation structurally identical to the `priceChf` guard four lines above it (`page.tsx:258`), which had used `a.registration_id ? … : 0` — an explicit truthiness guard on the nullable FK, never a collapse — since it was written. The correct pattern was already in the file; the buggy line was the outlier.

### Step 2 — remove the surface (`dc91e71`)

Reviewing the fix, the owner judged the pill unnecessary at all: the per-seat price already rendered under each ticket type answers "what did this cost", and renders nothing when the seat cost nothing (`components/admin/AttendeeList.tsx:358`, guarded by `ticket.priceChf > 0`). The pill was a second, now-demonstrably-fragile way of saying the same thing.

So `dc91e71` deleted:

- `paymentState` from the `Attendee` interface (`components/admin/AttendeeList.tsx`) — nothing else read it;
- the `PaymentPill` component and its render site;
- the derivation from `page.tsx` entirely (the current file has no `paymentState` at all);
- and rewrote the test block from `describe("payment pill")` to `describe("no payment pill")`, asserting that no "Paid"/"Free"/"Comp"/"Special Guest" text renders regardless of price.

**Which step is the durable lesson:** step 1. Step 2 is a product call that happened to make this instance unreachable — a surface that does not exist cannot mislabel anything. But the defaulting pattern is what generalizes, and it is still live elsewhere in this codebase (see Prevention). A reader should take away *"a `??` default can assert a fact"*, not *"we deleted a pill"*.

Verification: `tsc --noEmit` clean; full unit suite **1333 passing**; lint clean apart from pre-existing `<img>` warnings in unrelated files.

## Why This Works

Two nullish-coalescing defaults, each individually defensible, stacked into a confident wrong answer.

**The first default destroys information.**

```ts
a.registration_id ?? ""
```

`registration_id` is `string | null` (declared at `page.tsx:157`). Null means a real, meaningful thing: *this ticket has no booking behind it*. Coercing it to `""` converts that fact into a different claim — *this ticket has a registration whose id is the empty string* — and the very next operation, a `Map.get`, is the step that depended on telling those two apart. By the time the lookup runs, the distinction it needed has already been thrown away one operator earlier.

**The second default fabricates one.**

```ts
regForRefundById.get("")?.status ?? "paid"
```

`regForRefundById` is keyed by real registration UUIDs (`page.tsx:200–203`), so `get("")` always misses, always yields `undefined`, and always falls through to `?? "paid"`. Read literally, that clause says: *when I cannot determine whether this was paid, report that it was paid.*

That was a true statement when it was written — verifiably so. The plan for this feature checked it against the shared production database on 2026-08-15: `select count(*) from tickets where registration_id is null` returned **0** (`docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md:536`). The column had been nullable for some time, but no row had ever used the null. Every ticket on the roster came from a booking, so an unresolvable registration meant a lookup glitch, not a legitimate registration-less ticket — and defaulting to `paid` was the safe reading of a transient miss. The default was an **encoded invariant**, not a typo.

The guest-list model then repealed the invariant. Plan decision **KD10** — *a guest is a ticket with `registration_id: null`* — deliberately introduced tickets that have no registration and never will. The default did not fail; it kept faithfully applying a rule that had stopped being true, to a population it was never written for. Since guest-list tickets *always* have a null FK, the wrong branch fired 100% of the time for them.

**The direction of the error is the part worth internalizing.** The failure asserted that money *was* collected. That is the expensive direction: it inflates apparent revenue on an operational screen, and it is the kind of claim a person acts on (an organiser deciding not to chase a payment; a volunteer at the door treating a guest as pre-paid). A default that failed the other way — toward "nothing was paid" — would have been noticed later or never, but it would not have misreported revenue. When a default has to pick a side, it should pick the side whose wrongness is cheap.

## Prevention

### The hazard statement, broadened: a newly-nullable FK breaks consumers *two* ways

State it this way so a future reader searches for both shapes:

1. **Rows vanish.** Joins, filters, `WHERE` clauses, counts, and aggregates that reach the table *through* the now-absent relation silently drop the new rows. Totals come out short; nothing errors.
2. **Attributes lie.** Rows that are present and rendered get one field filled in by a default — a `??`, a `||`, a coalesce, a fallback branch — because that default encoded the old invariant. Totals are fine; a field is false.

The first shape is the one people predict, and it is what this project's own plan predicted (`plan:536`). The second is what actually shipped. An audit that only looks for the first misses the second entirely, because the second leaves no trace in any join.

The line to carry: **grep the joins to find the rows that disappear; grep the `??` to find the rows that lie.**

**A third, quieter shape: the exclusion that is safe only by accident.** Capacity genuinely does not count guest-list tickets, and the reason is structural — the seat count is computed from registrations and their line items, and a guest-list ticket has neither, so it is never in the tables being summed. That is a strong guarantee. But the current seat function also reads `tickets` directly, to *subtract* cancelled seat-consuming ones. A guest-list ticket is spared only because nothing ever sets a cancellation status on it. Nothing enforces that. Give guest-list tickets a cancellation path some day and the seat count will start subtracting seats they never consumed — a negative-drift bug with no join to find it in. When you conclude "these rows are structurally excluded", check whether *every* branch of the computation reaches them the same way; one branch reading the table directly is enough to make the exclusion conditional rather than structural.

### The rule: it is not "avoid `??`" — it is *where the collapsed value lands*

`??` is fine. Collapsing a null into a sentinel is fine. What matters is what consumes the sentinel next:

- If the collapsed value flows into a **validator** — something that will reject it and say so — the collapse is **bounded and loud**. Worst case, a user sees an error.
- If the collapsed value flows into a **lookup with its own default** — something that will substitute a plausible answer for a missing one — the collapse is **silent and confident**. Worst case, a user believes a false fact.

The second is strictly worse, and it is the one that shipped here.

### The worked contrast, in this same codebase

The identical `?? ""` collapse, on the identical KD10 registration-less guests, still lives at `components/door/DoorConsole.tsx:440`:

```tsx
// Empty for a new-model list (no registration behind it, KD10). Only
// matters if a name/contact edit is saved from this row — check-in
// itself (SlotRow's checkInAdult) never reads registrationId.
registrationId={section.registrationId ?? ""}
```

It exists for a mundane reason: guest-list groups carry `registrationId: null` (`DoorConsole.tsx:259`) while the `SlotRow` prop is typed `registrationId: string` (`DoorConsole.tsx:611`), so the null must be flattened at the boundary. Same operator, same field, same data shape, same author.

But the destination is different — and tracing it precisely matters, because the obvious reading is wrong.

The tempting story is that this `""` reaches the validator in `app/api/public/door/[id]/save-attendee/route.ts` (lines 127–135), which rejects it:

```ts
const registrationId =
  typeof body.registrationId === "string" && UUID_RE.test(body.registrationId)
    ? body.registrationId
    : "";
...
if (!registrationId) return bad("registrationId is required");   // → HTTP 400
```

That code is real (`UUID_RE` at `route.ts:21`, `bad()` defaulting to 400 at `route.ts:23`) — **but a guest-list row never reaches it.** Every guest-list slot carries a real ticket id (`lib/events/door-access.ts:476`), so `SlotRow` always sends an `attendeeId` (`DoorConsole.tsx:656`), which routes the request into the *edit-an-existing-slot* branch at `route.ts:67`. That branch never reads `registrationId` at all; the validator above sits in the *fill-an-open-slot* path only.

So the `?? ""` at `DoorConsole.tsx:440` is not "bounded by a validator" — it is **inert**. It never reaches the check its own comment claims it matters for. (That comment is wrong for the same reason.)

**This is the more useful half of the contrast, and it is not the one I expected to write.** The tidy version of this section would have said: same collapse, one lands on a validator and fails loudly, one lands on a default and lies quietly. That story is false. On the door path *nothing* inspects the collapsed value — it is simply never read. The collapse was harmless by **accident**, not by a guard.

That distinction matters because accidental harmlessness is not a property you can rely on, and it does not survive refactoring. It is also actively misleading to a reader: the `?? ""` looks defensive, its comment asserts a purpose it does not have, and anyone auditing this file would tick it off as handled. The real rule is narrower and less comfortable than "validators are good, defaults are bad":

> A collapsed null is dangerous exactly when something **reads** it. Find the reader before you judge the collapse. If nothing reads it, the collapse is not safe — it is *unexamined*, and the next person to give that value a reader inherits a bug with a reassuring comment on top.

**A real bug, found by validating this write-up — and fixed in this PR.** Tracing the above turned up something worse than a stale comment: door-side contact capture for guest-list guests was **broken outright**. `DoorConsole.tsx:633` renders the "add an email" prompt for a guest with no email, but saving it returned `404 "Slot not found"` — because the edit branch matched `.eq("slot_status", "claimed")` while a guest-list ticket is minted `'issued'` (`lib/events/guest-lists.ts:355`) and stayed that way. The prompt appeared; the save never landed. Since a guest list is *defined* by deferring contact collection to the door, this was the feature failing at the one moment it exists for.

The fix widens that lookup to also match an `issued` ticket **that has a guest list behind it**, and promotes the row to `claimed` once a contact is captured — gated on actually having one, since `tickets_contact_present` only tolerates a contactless row while it is `issued`. The match is deliberately scoped to guest-list rows rather than to `issued` generally, so a registration-backed open slot still cannot be addressed directly by id and bypass `claim_ticket`'s allotment race check. Verified against the shared database: the widened predicate newly matches exactly two rows, both registration-less guest-list tickets, and no registration-backed row anywhere.

### This is the same axis as a prior learning here

`docs/solutions/database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md` (PR #74) records the rule: *when a key is ambiguous, choose the failure that is **bounded and visible** over the one that is **silent and loses a person**.* There, `claim_ticket` keyed on email alone and silently dropped guests who shared a mailbox. Here, a default keyed on nothing silently asserted payment. Different mechanism, same axis — and the same lesson about which way to lean when a lookup cannot resolve. *(auto memory [claude])*

### Concrete, testable practices

**1. Every fixture factory for a model with a nullable FK must have at least one row where the FK is null.**

The single change that would have caught this is not a new assertion — it is one fixture:

```ts
// components/admin/AttendeeList.test.tsx
it("renders a registration-less guest-list ticket without claiming it was paid", () => {
  renderList([ticket({ name: "Guest-list Guest", registrationId: null, priceChf: 0 })]);
  expect(screen.queryByText("Paid")).toBeNull();
});
```

Generalize it: when a factory hard-codes a value for a field the schema declares nullable, that is a latent blind spot, not a convenience. Either the factory should default the field to `null` (forcing every test to opt into the happy shape), or the file must carry at least one explicit null case. Grep your own fixtures for it:

```bash
# fields typed `| null` in the interface but never null in the test factory
grep -n "registrationId\|registration_id" components/**/*.test.tsx lib/**/*.test.ts
```

**2. When a model gains a nullable FK, sweep every existing consumer of that column — not just the code you are writing.**

The guest-list change created rows with `registration_id: null`; the bug landed in a file that change never touched. The sweep is mechanical:

```bash
# every collapse of the newly-nullable column
grep -rn 'registration_id ?? \|registrationId ?? ' app/ components/ lib/

# every default applied to a lookup on it
grep -rn '\.get(.*registration.*)\?\.\w\+ ?? ' app/ components/ lib/
```

Then for each hit ask the single question: **does this collapsed value reach a validator, or a defaulted lookup?** Validator → fine, note it. Defaulted lookup → it is now asserting something about a population it was not written for.

Run both halves of the broadened hazard, not just the join half:

```bash
# shape 1 — rows vanish: reads that reach the table through the relation
grep -rn "event_registrations\|registrations!inner\|\.in(\"registration_id\"" app/ lib/

# shape 2 — attributes lie: defaults applied near the newly-nullable column
grep -rn "registration_id.*??\|registrationId.*??\|?? \"paid\"\|?? \"" app/ components/ lib/
```

**3. When a plan names a data-shape hazard and lists affected sites, treat the list as a starting point, not a boundary.**

This bug's most transferable lesson is that a correctly-identified, correctly-mitigated, highest-severity risk still leaked. The gap was not analysis — the analysis was excellent — it was that the mitigation stayed a *standing question* ("treat 'does this read reach tickets through registrations?' as the standing question for every surface this plan touches", `plan:536`) rather than a *command someone ran and reviewed the output of*.

Concretely, for any plan that names a data-shape hazard:

- **Convert the mitigation into an executed sweep with reviewable output.** The greps in practice #2 *are* the mitigation that plan asked for. Run them once, exhaustively, over `app/`, `components/`, and `lib/`; paste the hit list into the plan or the PR; mark each hit handled, safe, or out-of-scope. A reviewed list of 40 hits with 37 marked "safe" is worth more than a correct instinct nobody executed.
- **Assume the enumerated site list is short.** It was written by the people holding the mental model that produced the hazard; sites that fail in a shape *outside* that model are precisely the ones recall will not surface. Here, two count/projection sites were listed and handled, and a third attribute-derivation site was never listed at all.
- **Ask what the *other* failure mode would look like.** If the plan predicts silent omission, spend one pass explicitly hunting silent mislabeling, and vice versa. That single inversion question is what would have found this line.
- **Prefer mitigations a machine can check.** "Grep X before assuming Y" is a good instruction precisely because it can be run and its output archived. "Keep Z in mind for every surface" cannot be, and degrades to nothing under normal working conditions.

**4. Review `??` defaults on *semantics*, not on null-safety.**

The reviewable question is never "is this null-safe" — `??` always is. It is: *what does this default claim, and is that claim still true?* Write the default out as a sentence and see if you would sign it:

```ts
?? "paid"   // "if I can't tell whether this was paid, say it was paid."
```

Stated that way, it fails review instantly. Stated as `?? "paid"`, it reads as tidy defensive code. When a default encodes an invariant ("every ticket has a booking"), say so in a comment naming the invariant — a future reader repealing that invariant can then grep for it.

**5. Prefer deriving the strong claim from positive evidence.**

Structure conditionals so the confident answer requires proof and the absence of data falls through to the modest one:

```ts
// Bad — confident by default, demoted only on evidence:
(map.get(id ?? "")?.status ?? "paid") === "free" ? "free" : "paid"

// Good — modest by default, promoted only on evidence:
id && map.get(id)?.status !== "free" ? "paid" : "free"
```

**6. When two fields on the same row disagree, believe the guarded one.**

The roster rendered "Paid" beside a blank price. Two derivations of the same underlying fact, one guarded (`a.registration_id ? … : 0`) and one collapsed (`?? ""` → `?? "paid"`), sitting ten lines apart in one file. That internal contradiction was visible on screen before anyone knew there was a bug. A row that contradicts itself is a lead, and the field with the explicit null guard is almost always the one telling the truth.

## Related Issues

- [A registration-keyed door roster silently orphans any attendee without a registration](../architecture-patterns/registration-keyed-door-roster-orphans-imported-attendees.md) — the same broken invariant (`tickets.registration_id` optional in schema, mandatory in practice), one surface earlier. There a registration-keyed projection made the guest **invisible**; here a registration-keyed `Map.get` with a `?? "paid"` default made the guest **mislabeled**. ⚠️ That doc's prescribed fix — give every comp guest a real zero-price registration — is *reversed* by KD10 and needs refreshing.
- [Don't reuse a column that's force-null for a row category as a value source](../architecture-patterns/reusing-nullable-column-as-value-source-trap.md) — the pricing-side discovery of the same rule: `Number(null) === 0` and `x ?? 0` turn absence into a plausible value. Its loud-500-on-the-charge-path vs silent-empty-panel-on-the-display-path contrast is exactly "a validator fails loudly, a default lies silently." That doc scopes the trap to value columns; this one extends it to a foreign key used as a lookup key.
- [A replay guard's identity key silently swallows a seat when it is too loose or too tight](../database-issues/contact-only-replay-guard-swallows-people-sharing-an-email.md) — the same failure-visibility principle from the write side: prefer the failure that is bounded and visible over the one that is silent. Both bugs start with a key that collapses distinct inputs into one bucket — an email collapsing two people there, `registration_id ?? ""` collapsing "no registration" into one empty-string key here.
- [Cancelled seats reappear when counts derive from registration.quantity](cancelled-seats-reappear-when-counts-derive-from-registration-quantity.md) — the adjacent "a derived admin figure misrepresents guest-list seats" learning. ⚠️ Its model statement ("a guest list in this schema *is* a free registration") predates KD10 and should be read with that in mind.
- [Single-writer field ownership: a relocated field's PATCH route must be its only writer](../architecture-patterns/single-writer-field-ownership-across-routes.md) — the write-path twin of this trap: there a route coerces missing input to a default and destroys stored data; here a derivation coerces a missing lookup to a default and fabricates a label.
