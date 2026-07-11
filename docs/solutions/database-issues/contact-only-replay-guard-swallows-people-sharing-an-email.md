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

Three callers were exposed: self-registration via the party link, the door console's walk-up fill, and the **free**-checkout roster fill (`fillRegistrationRoster`, one `claim_ticket` per guest the booker named). The paid checkout path escaped only because it goes through `apply_pending_roster`, which does not dedupe at all — which is why paid group bookings on one email have all their tickets and the bug stayed hidden.

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

## What to watch for

- Any dedupe or idempotency key built from contact details alone has this bug. Contact identifies a *mailbox*, not a *human*.
- If you need a genuinely reliable replay guard for a per-person write, do not infer identity — carry an explicit idempotency key from the client, as `add_comp_guests` does with `comp_guest_batches`.
- The SQL here is not covered by the test suite (vitest mocks Supabase entirely). Verify changes to `claim_ticket` with a rolled-back `DO` block — see `verify-security-definer-rpc-do-block-rollback.md`.
