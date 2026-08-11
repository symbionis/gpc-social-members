---
title: "A replay guard keyed on contact alone silently swallows two people who share an email"
date: "2026-07-11"
last_refreshed: "2026-07-11"
last_updated: "2026-07-11"
category: "database-issues"
module: "events"
problem_type: "silent_data_loss"
component: "database"
severity: "high"
applies_when:
  - "Writing an idempotency or replay guard for a per-person write"
  - "Deduping tickets, attendees, registrations, or roster entries on email or phone"
  - "Any flow where one person books or registers on behalf of several people"
  - "Reviewing claim_ticket, apply_pending_roster, or any future fill-a-slot RPC"
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
---

## The problem

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

As of 2026-08-11 two direct callers remain: the door console's walk-up fill (`app/api/public/door/[id]/save-attendee/route.ts:132`) and the free-checkout roster fill (`lib/events/roster.ts:115`), plus the SQL-internal call inside `apply_pending_roster`. Self-registration via the party link was retired (`claim_self_registration` dropped in `supabase/migrations/20260722150000_drop_self_reg_token.sql:8`).

## The fix

**Identity is name + contact, not contact.** A replay is the same person claiming twice: same name *and* same contact. A different name on the same address is a different person and gets their own slot.

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

That table describes the *door and fill* paths. At **purchase** time there is now a third, better failure: the buyer is asked to distinguish the two guests. `lib/events/attendee-input.ts` rejects two seats carrying the same normalized name *and* email with a 400 — bounded, visible, and recoverable before any money moves.

## Where the rule lives now

Since top-ups had to name every seat (PR #111), the rule is enforced one layer **above** the RPC, at the API boundary. `lib/events/attendee-input.ts` is the single shared validator, called by both purchase paths — the public register route and the top-up route. It builds identity as `normalizeName(name).toLowerCase() + "|" + email` and says so in its own comment, naming `claim_ticket`'s guard as the reason for the key choice. A shared email is explicitly permitted (households book on one address); the same person named twice is not.

This is the shape to copy: the RPC keeps its guard as the last line of defence, and the boundary that has the user's attention refuses the ambiguous input while it can still be corrected.

## What to watch for

- Any dedupe or idempotency key built from contact details alone has this bug. Contact identifies a *mailbox*, not a *human*.
- **An absent mailbox is a normal, designed state.** Comp guest lists routinely carry no email at all — the door captures it at admission — so a guard must not assume contact is *present*, let alone unique.
- If you need a genuinely reliable replay guard for a per-person write, do not infer identity — carry an explicit idempotency key from the client, as `add_comp_guests` does with `comp_guest_batches`.
- The SQL here is not covered by the test suite (vitest mocks Supabase entirely). Verify changes to `claim_ticket` with a rolled-back `DO` block — see `verify-security-definer-rpc-do-block-rollback.md`.
