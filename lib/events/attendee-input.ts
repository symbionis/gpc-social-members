// Guest names and emails submitted at purchase, validated once for every path that sells a
// seat.
//
// Mandatory naming (R1) is enforced in more than one place — the public checkout and the
// lead's buy-more top-up both mint tickets — and a rule enforced twice is a rule that drifts.
// Top-ups shipped without any naming at all, which is how a paid booking could still grow an
// unnamed, contactless seat long after checkout stopped allowing one.
//
// The rule, in one sentence: every purchased seat gets exactly one name and one email, no
// fewer and no more, and no two seats OF THE SAME TICKET TYPE may name the same person twice.
//
// That last clause is the whole subtlety. Guests share an email freely (a household books on
// one address, R2) and one guest may hold several seats of different types (Friday and
// Saturday of the same summit). What is refused is one person twice on one type, because the
// database cannot represent it: claim_ticket treats the second as a replay of the first,
// claims nothing, and reports success. Refusing it out loud at the door of the API is the only
// way the buyer ever learns their guest went unnamed.

import { isFullName } from "@/lib/names";
import type { RosterFillAttendee } from "@/lib/events/roster";
import { personIdentityKey, ticketIdentityKey } from "@/lib/events/order";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ATTENDEE_NAME = 120;
export const MAX_ATTENDEE_EMAIL = 254;

export type AttendeeParseResult =
  | { ok: true; attendees: RosterFillAttendee[] }
  | { ok: false; error: string };

/**
 * The key `claim_ticket` dedupes on: case-folded, whitespace-collapsed name plus lowercased
 * contact, plus ticket type. Two submissions with the same key collapse into ONE ticket at
 * claim time — the second returns the first's ticket with `already: true` and claims no seat.
 *
 * SCOPED TO ONE TICKET TYPE. The same human legitimately holds two seats of DIFFERENT types —
 * a multi-day event sells Friday and Saturday separately, and one person buying both is the
 * ordinary case, not a mistake. Keying on name+contact alone made that unrepresentable: the
 * second day collapsed into the first and the seat stayed unnamed forever. What the key is
 * actually for is idempotency, and a genuine retry replays the same type too, so narrowing it
 * costs no replay safety.
 *
 * Defined once, in `lib/events/order.ts` (U1) — the shared order module — as
 * `ticketIdentityKey`, and re-exported here under this file's historical name so this file's
 * own callers (`collidesWithClaimed` below, and the duplicate check in `parseAttendeeInput`)
 * can't drift from it. Both this file and order.ts must mirror the same SQL guard, so both use
 * the one definition.
 */
export const attendeeIdentity = ticketIdentityKey;

/** A seat already named on a booking, as the collision check needs to see it. */
export type ClaimedIdentity = {
  name: string | null;
  email: string | null;
  /**
   * Null on a legacy seat minted before ticket types existed. `claim_ticket` lets such a seat
   * absorb a typed claim (it adopts the type on match), so an untyped claimed seat collides
   * with EVERY type here — mirroring the SQL rather than letting the TS check pass something
   * the database will then silently swallow.
   */
  ticket_type_id: string | null;
};

/**
 * Find the first submitted guest who is already a named seat on this booking, for the same
 * ticket type.
 *
 * `parseAttendeeInput` can only see one order at a time, so it catches the same person named
 * twice *within* one order. It cannot see that the booker already holds a seat under that name
 * and email. Left unchecked, that seat is paid for, minted, and permanently unnamed:
 * `claim_ticket` reports success and consumes nothing.
 *
 * Both purchase paths need this and for the same reason. A top-up adds to a booking whose seats
 * are already named. Public checkout has no claimed rows yet at validation time — the lead's
 * seat is seeded moments later from the booker's own fields — so its caller passes that
 * pending identity in rather than reading the table.
 */
export function collidesWithClaimed(
  attendees: RosterFillAttendee[],
  claimed: ClaimedIdentity[],
): { name: string } | null {
  // identity (name+email, type-free) → the types it already holds. `null` in the set means an
  // untyped legacy seat, which matches any type.
  const takenTypes = new Map<string, Set<string | null>>();
  for (const c of claimed) {
    if (!c.name || !c.email) continue;
    const key = personIdentityKey(c.name, c.email);
    const types = takenTypes.get(key) ?? new Set<string | null>();
    // A row with no type at all is treated as the untyped legacy seat it is, and matches every
    // type — never as "no collision". Failing open here would let through exactly the write the
    // database then swallows.
    types.add(c.ticket_type_id ?? null);
    takenTypes.set(key, types);
  }
  for (const a of attendees) {
    const types = takenTypes.get(personIdentityKey(a.name, a.email ?? ""));
    if (types && (types.has(null) || types.has(a.ticket_type_id))) return { name: a.name };
  }
  return null;
}

/**
 * Validate submitted attendees against how many names each ticket type still needs.
 *
 * `requiredPerType` is what the caller must be covered for — the purchased quantity of that
 * type, minus any seat already filled another way (the public checkout seeds the buyer's own
 * slot from the booker fields, so it asks for one fewer of the lead's type; a top-up seeds
 * nothing and asks for all of them).
 *
 * Returns a message safe to hand to the buyer; every failure is a 400-shaped refusal rather
 * than a silently dropped guest.
 */
export function parseAttendeeInput(
  raw: unknown,
  requiredPerType: Map<string, number>,
  isKnownType: (ticketTypeId: string) => boolean,
  maxAttendees: number,
): AttendeeParseResult {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > maxAttendees) {
    return { ok: false, error: "Too many attendees for one order" };
  }

  const attendees: RosterFillAttendee[] = [];
  const namedPerType = new Map<string, number>();
  // Two attendees that normalize to the same (name, email, ticket type) collapse into one
  // ticket at claim time — claim_ticket's replay guard keys on the same case-folded,
  // whitespace-collapsed name plus contact plus type — silently leaving the sibling slot
  // unnamed and defeating mandatory naming (R1). A shared email is fine (households, R2), and
  // so is the same guest on two DIFFERENT types (one person, Friday and Saturday); the same
  // person twice on the SAME type is not. The key mirrors claim_ticket's normalization.
  const seenIdentities = new Set<string>();

  for (const entry of list) {
    const rec = (entry ?? {}) as { ticket_type_id?: unknown; name?: unknown; email?: unknown };
    const ttId = typeof rec.ticket_type_id === "string" ? rec.ticket_type_id : "";
    if (!isKnownType(ttId)) {
      return { ok: false, error: "An attendee references a ticket not in your order" };
    }

    const nm = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!nm) return { ok: false, error: "Each named ticket needs a name" };
    if (nm.length > MAX_ATTENDEE_NAME) {
      return { ok: false, error: "An attendee name is too long" };
    }
    // Every guest needs a surname to be filed under (R8) — no name-only path.
    if (!isFullName(nm)) {
      return { ok: false, error: "Each named guest needs a first and last name" };
    }

    const e = typeof rec.email === "string" ? rec.email.trim().toLowerCase() : "";
    if (!e || !EMAIL_RE.test(e)) {
      return { ok: false, error: "Each named guest needs a valid email" };
    }
    if (e.length > MAX_ATTENDEE_EMAIL) {
      return { ok: false, error: "An attendee email is too long" };
    }

    const identity = attendeeIdentity(nm, e, ttId);
    if (seenIdentities.has(identity)) {
      return {
        ok: false,
        error:
          "Two guests on the same ticket have the same name and email — give each guest a distinct name (the same email is fine)",
      };
    }
    seenIdentities.add(identity);

    namedPerType.set(ttId, (namedPerType.get(ttId) ?? 0) + 1);
    attendees.push({ ticket_type_id: ttId, name: nm, email: e });
  }

  // Exact cover: neither fewer nor more named guests than seats. Fewer would mint an unnamed
  // ticket; more would silently discard a name the buyer typed.
  for (const [ttId, required] of requiredPerType) {
    if ((namedPerType.get(ttId) ?? 0) !== required) {
      return {
        ok: false,
        error: "Every ticket needs a name and email before checkout can complete",
      };
    }
  }
  // A name against a type that needed none is the same error from the other side.
  for (const ttId of namedPerType.keys()) {
    if (!requiredPerType.has(ttId)) {
      return {
        ok: false,
        error: "Every ticket needs a name and email before checkout can complete",
      };
    }
  }

  return { ok: true, attendees };
}
