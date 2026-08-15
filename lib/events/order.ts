// The shared order shape and its rules (U1, KTD1).
//
// An order arrives at three surfaces today — public checkout, a booking's top-up, and a
// booking's guest-add — as two parallel arrays: a basket of `{ ticket_type_id, quantity }`
// and a separately-typed list of named attendees. Reconciling the two (does every purchased
// seat have exactly one name? does every named seat match a purchased type?) is where bugs
// have come from: an unnamed seat, a miscounted multi-day basket.
//
// This module removes the reconciliation step by removing the second array (KD1): an order
// IS a list of people, each carrying the ticket type(s) they hold. Quantities are never
// submitted — they're derived by grouping (`deriveTicketCounts`), so there is nothing left to
// reconcile against.
//
// KD4: a day is a ticket type; the platform has no multi-day concept. Nothing here
// special-cases "multi-day" — it only stops assuming one person holds exactly one ticket. A
// person holding Friday and Saturday of the same summit is the same shape as a person holding
// one ticket: one more entry in their `ticketTypeIds`.
//
// KD5: `validateOrder` never bails on the first problem. It walks the whole order and returns
// every violation in one pass, each naming the rule, the person (by index) and the field that
// caused it — except an order-scoped violation (a bound this module enforces, like the people
// cap), which carries neither. Pinning a limit breach to an arbitrary row would misdirect the
// fix; an order-scoped violation is meant to render above the rows, not next to one of them.
//
// KD6: this module owns policy — names, emails, the identity key, the caller-supplied bounds.
// The one thing it deliberately does NOT own is concurrency: the database's replay guard on
// `claim_ticket` is the only thing that can see two requests racing each other, and no amount
// of validation here changes that. Seat capacity and invite limits are enforced elsewhere too
// (order-scoped, not this module's job) — they're what an order-scoped violation is for.
//
// Pure and dependency-free on purpose, like `roster-sort.ts`: two of the three call sites this
// unblocks are client components (both purchase forms), and importing this module must not
// drag server-only code (Supabase service-role client, `next/headers`, server env reads) into
// their bundles.

import { isFullName, normalizeName } from "@/lib/names";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_PERSON_NAME = 120;
export const MAX_PERSON_EMAIL = 254;

/**
 * One person in an order, carrying the ticket type(s) they hold (R1). A ticket cannot exist
 * without a person attached to it (R2) — there is no separate quantity array for one to go
 * missing from.
 */
export interface OrderPerson {
  name: string;
  email: string;
  /**
   * One entry per ticket type this person holds. A type appearing twice for the same person
   * is refused (R3) — it is not a shorthand for "two of this type"; a household of two people
   * on the same type is two `OrderPerson` entries, not one entry with a doubled type.
   */
  ticketTypeIds: string[];
}

/**
 * Caller-supplied caps. Both purchase routes are unauthenticated, so a bound is what stops an
 * arbitrary payload reaching a service-role write — but different routes may want different
 * bounds (checkout vs. a top-up on an existing booking), so this module takes them as input
 * rather than hardcoding one number for everyone.
 */
export interface OrderBounds {
  /** Upper bound on `people.length`. */
  maxPeople: number;
  /**
   * Upper bound on the DERIVED ticket count — the sum of every person's
   * `ticketTypeIds.length`, i.e. what `deriveTicketCounts`'s values would sum to.
   */
  maxTickets: number;
}

export type OrderViolationField = "name" | "email" | "ticketTypeIds";

export type OrderViolationRule =
  | "empty_order"
  | "too_many_people"
  | "too_many_tickets"
  | "name_required"
  | "name_too_long"
  | "name_needs_first_and_last"
  | "email_required"
  | "email_invalid"
  | "email_too_long"
  | "no_ticket_types"
  | "unknown_ticket_type"
  | "duplicate_ticket_type_for_person";

/**
 * One rule broken by the order. A naming/identity fault points at the row that caused it
 * (`personIndex`, `field`); an order-scoped fault — a bound enforced here rather than a
 * per-row rule, such as the people cap — carries neither (KD5). A seat-capacity or
 * invite-limit breach is enforced by the caller, not this module, for the same reason: it
 * would also render with `personIndex: null`, above the rows, if it were reported here.
 */
export interface OrderViolation {
  rule: OrderViolationRule;
  message: string;
  personIndex: number | null;
  field: OrderViolationField | null;
}

export interface OrderValidationResult {
  ok: boolean;
  violations: OrderViolation[];
}

function personViolation(
  rule: OrderViolationRule,
  message: string,
  personIndex: number,
  field: OrderViolationField,
): OrderViolation {
  return { rule, message, personIndex, field };
}

function orderScopedViolation(rule: OrderViolationRule, message: string): OrderViolation {
  return { rule, message, personIndex: null, field: null };
}

/**
 * The person half of the identity key: case-folded, whitespace-collapsed name plus lowercased
 * email (R4). Two people share this key when a household books on one address — sharing an
 * email is never, on its own, a violation (R3's household carve-out).
 */
export function personIdentityKey(name: string, email: string): string {
  return `${normalizeName(name).toLowerCase()}|${email.trim().toLowerCase()}`;
}

/**
 * The full identity key `claim_ticket` dedupes on: case-folded name, lowercased email, PLUS
 * ticket type (R4). Two submissions with the same key collapse into one ticket at claim
 * time — the second returns the first's ticket with `already: true` and claims no seat.
 *
 * Scoped to one ticket type on purpose: the same person legitimately holds two seats of
 * DIFFERENT types (Friday and Saturday of the same event — KD4), and narrowing the key to
 * include the type is what makes that representable rather than collapsing the second day
 * into the first.
 *
 * `lib/events/attendee-input.ts` re-exports this under its historical name
 * (`attendeeIdentity`) rather than keeping its own copy, so the two files can't drift from
 * each other — both must mirror the same SQL guard.
 */
export function ticketIdentityKey(name: string, email: string, ticketTypeId: string): string {
  return `${personIdentityKey(name, email)}|${ticketTypeId}`;
}

/**
 * Validate an order in one pass, accumulating every violation rather than stopping at the
 * first (KD5, R5). `bounds` are supplied by the caller. `isKnownTicketType`, when given,
 * additionally refuses a ticket type id the caller doesn't recognise (e.g. one that isn't
 * part of the event's basket) — omit it when the caller has no such set to check against.
 */
export function validateOrder(
  people: OrderPerson[],
  bounds: OrderBounds,
  isKnownTicketType?: (ticketTypeId: string) => boolean,
): OrderValidationResult {
  const violations: OrderViolation[] = [];

  if (people.length === 0) {
    violations.push(orderScopedViolation("empty_order", "An order needs at least one person"));
  }
  if (people.length > bounds.maxPeople) {
    violations.push(
      orderScopedViolation(
        "too_many_people",
        `A maximum of ${bounds.maxPeople} people can be on one order`,
      ),
    );
  }

  // Identity keys seen so far, scoped to (person, ticket type). R3 and the household
  // carve-out fall out of the same set: two DIFFERENT names sharing an email never collide
  // (the key includes the name), and one person holding two DIFFERENT types never collides
  // (the key includes the type). This also catches a duplicate type within one person's own
  // `ticketTypeIds` — the same key, reached twice while walking the same person.
  const seenTicketIdentities = new Set<string>();
  let totalTickets = 0;

  people.forEach((person, personIndex) => {
    const rawName = typeof person.name === "string" ? person.name : "";
    const rawEmail = typeof person.email === "string" ? person.email : "";
    const trimmedName = rawName.trim();
    const trimmedEmail = rawEmail.trim();

    if (!trimmedName) {
      violations.push(personViolation("name_required", "Each person needs a name", personIndex, "name"));
    } else {
      if (trimmedName.length > MAX_PERSON_NAME) {
        violations.push(personViolation("name_too_long", "A name is too long", personIndex, "name"));
      }
      // Every person needs a surname to be filed under — no name-only entry (mirrors
      // attendee-input.ts's R8).
      if (!isFullName(trimmedName)) {
        violations.push(
          personViolation(
            "name_needs_first_and_last",
            "Each person needs a first and last name",
            personIndex,
            "name",
          ),
        );
      }
    }

    if (!trimmedEmail) {
      violations.push(personViolation("email_required", "Each person needs an email", personIndex, "email"));
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      violations.push(personViolation("email_invalid", "Each person needs a valid email", personIndex, "email"));
    } else if (trimmedEmail.length > MAX_PERSON_EMAIL) {
      violations.push(personViolation("email_too_long", "An email is too long", personIndex, "email"));
    }

    const ticketTypeIds = Array.isArray(person.ticketTypeIds) ? person.ticketTypeIds : [];
    if (ticketTypeIds.length === 0) {
      violations.push(
        personViolation("no_ticket_types", "Each person needs at least one ticket", personIndex, "ticketTypeIds"),
      );
    }

    for (const ticketTypeId of ticketTypeIds) {
      totalTickets += 1;

      if (isKnownTicketType && !isKnownTicketType(ticketTypeId)) {
        violations.push(
          personViolation(
            "unknown_ticket_type",
            "A ticket references a type not in this order",
            personIndex,
            "ticketTypeIds",
          ),
        );
        continue;
      }

      const key = ticketIdentityKey(trimmedName, trimmedEmail, ticketTypeId);
      if (seenTicketIdentities.has(key)) {
        violations.push(
          personViolation(
            "duplicate_ticket_type_for_person",
            "This person already holds this ticket type on this order",
            personIndex,
            "ticketTypeIds",
          ),
        );
        continue;
      }
      seenTicketIdentities.add(key);
    }
  });

  if (totalTickets > bounds.maxTickets) {
    violations.push(
      orderScopedViolation(
        "too_many_tickets",
        `A maximum of ${bounds.maxTickets} tickets can be booked at once`,
      ),
    );
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Group people into per-type counts for the line-item array — the derivation that replaces
 * submitting a separate quantity array (R1). Purely a grouping: it counts every entry as
 * given, including one `validateOrder` would refuse, so callers validate first and derive
 * second.
 */
export function deriveTicketCounts(people: OrderPerson[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const person of people) {
    const ticketTypeIds = Array.isArray(person.ticketTypeIds) ? person.ticketTypeIds : [];
    for (const ticketTypeId of ticketTypeIds) {
      counts.set(ticketTypeId, (counts.get(ticketTypeId) ?? 0) + 1);
    }
  }
  return counts;
}
