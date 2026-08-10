// Guest names and emails submitted at purchase, validated once for every path that sells a
// seat.
//
// Mandatory naming (R1) is enforced in more than one place — the public checkout and the
// lead's buy-more top-up both mint tickets — and a rule enforced twice is a rule that drifts.
// Top-ups shipped without any naming at all, which is how a paid booking could still grow an
// unnamed, contactless seat long after checkout stopped allowing one.
//
// The rule, in one sentence: every purchased seat gets exactly one name and one email, no
// fewer and no more, and no two seats may name the same person twice.

import { isFullName, normalizeName } from "@/lib/names";
import type { RosterFillAttendee } from "@/lib/events/roster";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ATTENDEE_NAME = 120;
export const MAX_ATTENDEE_EMAIL = 254;

export type AttendeeParseResult =
  | { ok: true; attendees: RosterFillAttendee[] }
  | { ok: false; error: string };

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
  // Two attendees that normalize to the same (name, email) collapse into one ticket at claim
  // time — claim_ticket's replay guard keys on the same case-folded, whitespace-collapsed name
  // plus contact — silently leaving the sibling slot unnamed and defeating mandatory naming
  // (R1). A shared email is fine (households, R2); the same person named twice is not. The key
  // mirrors claim_ticket's normalization.
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

    const identity = `${normalizeName(nm).toLowerCase()}|${e}`;
    if (seenIdentities.has(identity)) {
      return {
        ok: false,
        error: "Two guests have the same name and email — give each guest a distinct name",
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
