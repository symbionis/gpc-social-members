---
title: "A replay guard's identity key silently swallows a seat when it is too loose or too tight"
date: "2026-07-11"
last_refreshed: "2026-08-14"
last_updated: "2026-08-14"
category: "database-issues"
module: "events"
problem_type: "silent_data_loss"
component: "database"
severity: "high"
applies_when:
  - "Writing an idempotency or replay guard for a per-person write"
  - "Deduping tickets, attendees, registrations, or roster entries on email or phone"
  - "Any flow where one person books or registers on behalf of several people"
  - "Any flow where one person legitimately holds several seats — a multi-day event selling days as separate ticket types"
  - "Reviewing claim_ticket, apply_pending_roster, or any future fill-a-slot RPC"
  - "Calling an RPC that reports a did-nothing outcome in its payload rather than raising"
related_components:
  - door-console
  - registrations
tags:
  - events
  - tickets
  - idempotency
  - dedupe
  - silent-bug
  - claim-ticket
  - ticket-types
---

> **This key has been wrong in both directions, and its silent failure has now landed three
> times.** 2026-07-11: keyed too *loosely* (contact only), so two people sharing an email
> collapsed into one. 2026-08-11: the too-tight key first bit at top-up, where a lead adding a
> seat under their own name got `already: true` — closed at the API boundary (PR #112) without
> touching the key itself. 2026-08-14: the same too-tight key bit again at checkout, where one
> person's two ticket types collapsed into one, and this time the key was fixed (PR #132).
> All three produced the identical artifact: a sold, counted, permanently unnamed seat found at
> the door. Read the whole file before changing this key. Fixing one direction is how the other
> one got created — and patching the boundary instead of the key is how a key already known to
> be wrong survived another three days.

## The problem (2026-07-11): keyed too loosely

`claim_ticket` — the RPC that fills an open slot with a named person — guarded against replays by looking for an existing claimed ticket on the same registration with the same contact:

```sql
(v_email IS NOT NULL AND lower(email) = v_email)
OR (v_phone IS NOT NULL AND phone_e164 = v_phone)
```

The intent was right: a double-click, a network retry, or a back-and-resubmit should return the existing ticket rather than burn a second slot.

The key was wrong. **Two different people legitimately share an address** — a couple, a family, a booker who puts their own email on the whole party. Keying only on contact reads the *second* person as a replay of the *first*: the RPC returns `{status: 'claimed', already: true}` carrying the **first person's name**, never claims a slot for the second, and every caller treats that as success.

The guest silently does not exist. Nobody finds out until the door.

Reproduced against the live schema — Alice and Bob, one shared address, a party of two:

```
alice = Alice Smith / already=false
bob   = Alice Smith / already=true      <-- Bob was told he is Alice
named_tickets = 1                        <-- should be 2
```

Every path that named a slot was exposed — including the paid one. `apply_pending_roster` `PERFORM`s `public.claim_ticket` once per guest (`supabase/migrations/20260708130000_apply_pending_roster.sql:50-60`), so the paid checkout inherited the same guard rather than escaping it. *(An earlier revision of this doc, and the header of the fix migration `20260711140000_claim_ticket_identity_dedupe.sql:25-26`, both claimed the paid path escaped because `apply_pending_roster` "does not dedupe at all." That was wrong, and nothing in the repo supports the "paid group bookings kept all their tickets" explanation.)*

As of 2026-08-14 two direct callers remain: the door console's walk-up fill (`app/api/public/door/[id]/save-attendee/route.ts:132`) and the free-checkout roster fill (`lib/events/roster.ts:196`), plus two SQL-internal calls — inside `apply_pending_roster` and inside the top-up roster application (`supabase/migrations/20260811064034_topup_owns_its_roster.sql:90`). Self-registration via the party link was retired (`claim_self_registration` dropped in `supabase/migrations/20260722150000_drop_self_reg_token.sql:8`).

## The fix

**Identity is name + contact + ticket type.** A replay is the same person claiming the same
thing twice: same name, same contact, *and* same ticket type. A different name on the same
address is a different person and gets their own slot; the same person on a different ticket
type is a different purchase and gets their own slot too.

> The 2026-07-11 fix stated this rule as **"identity is name + contact, not contact"** and
> stopped there. That was the whole rule for five weeks, and it is what made the second failure
> below possible — a reader implementing it faithfully reproduces the too-tight bug. The type
> was added on 2026-08-14 (PR #132).

The name comparison folds case **and collapses internal whitespace**:

```sql
regexp_replace(lower(trim(coalesce(name, ''))), '\s+', ' ', 'g')
  = regexp_replace(lower(v_name), '\s+', ' ', 'g')
```

`trim()` alone is not enough — it strips the ends, not a double space in the middle, so a retry typed with sloppy spacing would burn a second slot. This was caught by a test, not by reading the code.

## The trade, stated plainly

Narrowing the guard means it can now **under**-dedupe: one person retrying with a differently-spelled name ("Max", then "Max Pinter-Krainer") consumes a second slot.

That is the better failure, and the reasoning generalises:

| | Old failure | New failure |
|---|---|---|
| What happens | A real guest silently vanishes | An extra slot is consumed |
| Bounded? | No — any number of guests | Yes — the cap refuses to exceed purchased quantity |
| Visible? | No | Yes — the party shows an extra named guest |
| Recoverable? | Not at the door | Yes — staff release the slot |

**When a dedupe key is ambiguous, prefer the failure that is bounded and visible over the one that is silent and loses a person.**

**But narrowing has its own silent failure, and this table did not anticipate it.** The "new
failure" column assumes the only cost of a tighter key is an *extra* slot consumed. That holds
when the guard under-matches two writes it should have merged. It does **not** hold when the
guard over-matches two writes that were never the same — there the tighter key resurrects
column one, a real seat silently vanishing, which is exactly what happened on 2026-08-14. A
narrower key is only the safer trade when every dimension you narrowed *on* is genuinely part
of the request.

That table describes the *door and fill* paths. At **purchase** time there is now a third, better failure: the buyer is asked to distinguish the two guests. `lib/events/attendee-input.ts` rejects two seats carrying the same normalized name, email **and ticket type** with a 400 — bounded, visible, and recoverable before any money moves.

## Where the rule lives now

Since top-ups had to name every seat (PR #111), the rule is enforced one layer **above** the RPC, at the API boundary. `lib/events/attendee-input.ts` is the single shared validator, called by both purchase paths — the public register route and the top-up route. It builds identity as the person half — `normalizeName(name).toLowerCase() + "|" + email` — plus the ticket type, and says so in its own comment, naming `claim_ticket`'s guard as the reason for the key choice. A shared email is explicitly permitted (households book on one address), and so is the same person on two different ticket types; the same person named twice **on one ticket type** is not.

This is the shape to copy: the RPC keeps its guard as the last line of defence, and the boundary that has the user's attention refuses the ambiguous input while it can still be corrected.

**The comparison set is the whole problem, and it differs per path.** `parseAttendeeInput` can only see one order at a time, so it catches the same person named twice *within* a purchase. It cannot see that the booking already has a seat under that name and email — and a **top-up is the one purchase path where prior claimed seats exist**, because it adds to a booking that has already been through checkout. A lead topping up under their own name and email therefore passed every check, paid, and got `already: true` from `claim_ticket`: no seat claimed, one seat left permanently unnamed. `collidesWithClaimed` closes that by checking the submitted guests against the seats already named, before money moves.

Two lessons generalise. **A dedupe key is only as good as the set it is compared against** — the same key is correct within an order and incomplete across a booking. And **the guard that returns "success, already done" is the dangerous one**: a rejection is visible, but an idempotent-looking success consumes nothing and reports nothing.

## The second failure (2026-08-14): the same guard, keyed too tightly

Adding the name fixed the too-loose direction and created a too-tight one. Because the key
omitted the **ticket type**, the guard silently enforced a second rule nobody designed and
nobody wrote down: *one human may hold at most one seat per booking*. That rule is false for
this product in two ordinary ways:

- **A multi-day event sells its days as separate ticket types.** ENLIGHTEN Summit sells a
  Friday day and a Saturday day; one person buying both is the normal purchase. The Saturday
  claim looked exactly like a replay of the Friday claim.
- **A booker names themselves in the guest row of a quantity-2 order.** The lead's own seat is
  seeded from the booker fields, so the guest row carrying the same name and email read as a
  replay of the lead's claim.

Four bookings between 10 and 14 Aug 2026 — two on ENLIGHTEN Summit, two on Breath & Polo — sold
a seat that was never named. Each shows one named lead ticket and one `issued` ticket with NULL
`name` and NULL `email`.

**Three of the four were zero-total (free) bookings** and so ran the silent
`fillRegistrationRoster` path. The fourth was a paid booking, on 10 Aug — one day *before*
`apply_pending_roster` learned to report its unplaced guests
(`supabase/migrations/20260811070359_roster_apply_reports_unclaimed.sql`, applied 11 Aug). So no
warning existed for it either, and the "signal on one path, silence on the other" split is a
statement about the code as it stands today, not about the window these four fell in. During the
window itself, every path was silent. That is why the count reached four before anyone looked.

Three things follow from the blank:

- **The seat is sold and counts against the event**, while the person on it is unknown.
- **Its QR reaches nobody.** Grouped household delivery keys on the ticket's own email
  (`lib/email/household-tickets.ts:175` filters out any ticket without one before grouping), so
  an unnamed seat is never in a group, never sent, and its `qr_email_sent_at` stays NULL —
  indistinguishable at a glance from a send merely pending retry.
- **At the door there is nobody to admit.** `checkin_by_credential` returns
  `status: 'needs_name'` for an issued/unnamed ticket, which is the first moment a human sees
  the problem — standing at the gate. That prompt is the only reason the loss was recoverable.

**Validation was never the hole.** The register route already enforced exact-cover naming
through `parseAttendeeInput` — neither fewer nor more names than seats, per ticket type. All
four bookings arrived at the API with a complete, correct set of names. The names were accepted,
sent to the database, and discarded there.

**A non-error was read as a success.** `fillRegistrationRoster` (the free path,
`lib/events/roster.ts`) called `claim_ticket` once per attendee and inspected only the Supabase
`error` field. `already: true` is not an error — it is a perfectly successful call reporting, in
its payload, that it did nothing. So the free path lost a guest and logged nothing at all.

The paid path had been taught to report the same loss on 11 Aug (`apply_pending_roster` now
collects the guests it could not place and raises a warning), which is why the failure looked
intermittent rather than systematic once anyone went looking. But that lesson had been learned
in SQL and never carried into TypeScript — see the correction under **What to watch for**.

### The fix (PR #132)

One clause added to the guard's `WHERE`
(`supabase/migrations/20260814150000_claim_ticket_replay_guard_scoped_to_type.sql`):

```sql
AND (v_ticket IS NULL OR ticket_type_id IS NULL OR ticket_type_id = v_ticket)
```

Both wide matches are deliberate. `v_ticket IS NULL` — the caller could not resolve a type, so
falling back to identity-only matching keeps replay safety rather than minting a duplicate on a
retry. `ticket_type_id IS NULL` — a legacy seat minted before ticket types existed must stay
matchable precisely because the block immediately below lets it **adopt** the incoming type;
excluding untyped rows would strand them untyped forever.

The app-layer mirror moved with it. `attendeeIdentity(name, email, ticketTypeId)` splits out a
`personKey` so both comparisons share one normalization, `ClaimedIdentity` gains
`ticket_type_id`, and `collidesWithClaimed` compares per type — a null type on an
already-*claimed* row is the untyped-legacy seat it is, and collides with **every** incoming
type rather than failing open. (The widening is one-directional, matching the SQL: a null on the
incoming side does not match every claimed type. Incoming attendees always carry a type, so this
is a deliberate asymmetry rather than a gap.) Failing open on the claimed side would let the API
accept exactly what the database then swallows.

The register route closes the collision `parseAttendeeInput` structurally cannot see: the
buyer's own seat is not among the guest rows, so it checks the submitted guests against the
**pending** lead identity `(name, email, leadType)` rather than the tickets table, and returns a
400 the buyer can read. Same type only — the buyer holding Friday and Saturday is not a
collision, and telling them to "name your guest" for their own second day would strand them with
no way to complete the order.

And `fillRegistrationRoster` now returns `{ filled, unnamed[] }`, counting a call as filled only
on a fresh claim, with `already: true` and every refusal status recorded as a failure with a
distinguishing reason. Anything unnamed logs one greppable line —
`[roster] SEATS LEFT UNNAMED after checkout fill` — carrying enough to reconcile by hand.

### Why narrowing by type costs no replay safety

A genuine retry is *the same claim run twice*, and the same claim carries the same ticket type.
A real replay still collapses onto the existing seat exactly as before. What changes is only
that two claims which were never the same claim stop being treated as one.

Four assertions pinned this down, and the middle two are the point: **when you narrow a guard,
assert not only that the new case works, but that the old bug does not come back.**

| | Case | Expected |
|---|---|---|
| A | Same person, **different** ticket type | Claims and names a second seat — the bug, fixed |
| B | Same person, **same** type (case + whitespace variants) | Still collapses — idempotency intact |
| C | **Different** person, same email | Still claims — the 2026-07-11 property, must not regress |
| D | Untyped legacy seat | Still matches, and still adopts the type |

C earned its place by being this doc's own earlier fix. Every previously fixed failure of a
shared guard deserves a standing assertion in the next change to it.

## What to watch for

- **A replay key must include everything that legitimately varies, and nothing that doesn't.** The test when writing one: for every dimension of the write, *can two legitimate, distinct writes differ only in this dimension?* If yes, it belongs in the key. Ticket type answered yes and was missing for five weeks. Anything left out of the key is a rule you are enforcing by accident — never documented, never validated, never explained to the user, and it deletes data. Conversely, narrowing is safe precisely because **a retry reproduces every dimension of the original call**; if adding a field to the key would break idempotency, that field is not actually part of the request.
- Any dedupe or idempotency key built from contact details alone risks this bug. Contact identifies a *mailbox*, not a *human*.
- **The dangerous shape is contact-only plus a silent success — not contact-only by itself.** A guard that *rejects visibly* on a contact match is a different, defensible trade: the affected person is told, and can act. The waitlist's one-entry-per-email rule (2026-08-11) is deliberately that shape — it returns a 400 the person can read, and the migration that added the index names the trade-off and points at itself as the line to change if the club ever needs two people on one mailbox. Judge a contact-only key by what it does when it matches, not by the key alone.
- **An absent mailbox is a normal, designed state.** Comp guest lists routinely carry no email at all — the door captures it at admission — so a guard must not assume contact is *present*, let alone unique.
- If you need a genuinely reliable replay guard for a per-person write, do not infer identity — carry an explicit idempotency key from the client, as `add_comp_guests` does with `comp_guest_batches`.
- The SQL here is not covered by the test suite (vitest mocks Supabase entirely). Verify changes to `claim_ticket` with a rolled-back `DO` block — see `verify-security-definer-rpc-do-block-rollback.md`. Two steps that recipe does not cover, both learned on 2026-08-14:
  - **Prove the transaction boundary before trusting the rollback.** Do not assume the SQL call is one transaction — establish it. Create a throwaway function, follow it with a deliberately failing `DO` block in the same call, then confirm the function no longer exists. Only then is a rolled-back test actually safe on a database shared with production.
  - **After applying, prove the live function is the one you tested.** Comparing `prosrc` naively fails on whitespace and comments; compare the md5 of the comment-stripped, whitespace-normalized `prosrc` against the same normalization of the migration file's function body. For a re-declare, first remove your intended edit locally and expect a byte-exact match against live — that rules out accidental drift in the ~150 lines you copied. Passing against the candidate proves the SQL is right; passing against the deployed function proves the right SQL is deployed. Different claims.
- **A caller that discards this RPC's return value re-hides the bug.** `already: true` is reported, not raised — so the roster-apply functions, which looped `PERFORM claim_ticket(...)` and ignored every result, turned a swallowed guest back into silence and then cleared the staged names in the same transaction, deleting the evidence. They now collect the guests they could not place, return them to the caller where the signature allows it, and `RAISE WARNING` regardless. Reporting an outcome nobody reads is the same as not reporting it.
  - **Correction (2026-08-14): that fix covered the SQL functions only, and this bullet overstated it.** The TypeScript caller named two paragraphs above — `fillRegistrationRoster` in `lib/events/roster.ts` — kept checking only the Supabase `error` field for another month, and lost four guests in silence doing exactly what this bullet warns against. A prevention rule written for one language is not a prevention rule. When you fix a class of bug, enumerate **every** caller in every layer, not the ones in the file you are already editing.
  - Stated generally: **for any RPC whose contract includes a "did nothing" outcome, the caller must branch on the status field, and the did-nothing branch must be loud.** Here that means a `console.error` carrying enough payload to reconcile by hand, because the write is already paid for and cannot be rolled back.
