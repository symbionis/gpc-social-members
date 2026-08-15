import { describe, it, expect } from "vitest";
import {
  validateOrder,
  deriveTicketCounts,
  personIdentityKey,
  ticketIdentityKey,
  type OrderPerson,
  type OrderBounds,
} from "@/lib/events/order";

const BOUNDS: OrderBounds = { maxPeople: 20, maxTickets: 20 };

function violation(result: ReturnType<typeof validateOrder>, rule: string) {
  return result.violations.filter((v) => v.rule === rule);
}

describe("validateOrder — happy paths", () => {
  it("one person holding two ticket types is accepted as one person and two tickets", () => {
    const people: OrderPerson[] = [
      { name: "John Smith", email: "john@example.com", ticketTypeIds: ["day1", "day2"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);

    const counts = deriveTicketCounts(people);
    expect(counts.get("day1")).toBe(1);
    expect(counts.get("day2")).toBe(1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("two differently-named people on one email address are both accepted (a household)", () => {
    const people: OrderPerson[] = [
      { name: "Jane Doe", email: "shared@example.com", ticketTypeIds: ["day1"] },
      { name: "John Doe", email: "shared@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("the same person legitimately holds two seats of different ticket types", () => {
    const people: OrderPerson[] = [
      { name: "Ann Marie Lead", email: "ann@example.com", ticketTypeIds: ["friday", "saturday"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(true);
  });
});

describe("validateOrder — same-person, same-type duplication (R3)", () => {
  it("the same person twice on one ticket type is refused, attributed to the second entry", () => {
    const people: OrderPerson[] = [
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day1"] },
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const dupes = violation(result, "duplicate_ticket_type_for_person");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].personIndex).toBe(1);
    expect(dupes[0].field).toBe("ticketTypeIds");
  });

  it("case-folding and whitespace-collapsing make two spellings of the same identity collide", () => {
    const people: OrderPerson[] = [
      { name: "jane   doe", email: "Jane@Example.com", ticketTypeIds: ["day1"] },
      { name: "Jane Doe", email: " jane@example.com ", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(violation(result, "duplicate_ticket_type_for_person")).toHaveLength(1);
  });

  it("the same ticket type twice within one person's own list is also refused", () => {
    const people: OrderPerson[] = [
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day1", "day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const dupes = violation(result, "duplicate_ticket_type_for_person");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].personIndex).toBe(0);
  });
});

describe("validateOrder — accumulates every violation in one pass (KD5)", () => {
  it("an order violating three rules returns three violations, not the first", () => {
    const people: OrderPerson[] = [
      // 1. name too long AND not a full name (single overlong token) — but we want exactly
      //    3 violations total across the order, so keep this row otherwise clean: give it a
      //    valid two-part name that's simply too long.
      {
        name: `${"A".repeat(60)} ${"B".repeat(70)}`,
        email: "valid@example.com",
        ticketTypeIds: ["day1"],
      },
      // 2. invalid email
      { name: "John Smith", email: "not-an-email", ticketTypeIds: ["day1"] },
      // 3. no ticket types at all
      { name: "No Tickets", email: "none@example.com", ticketTypeIds: [] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(3);
    expect(result.violations.map((v) => v.rule).sort()).toEqual(
      ["email_invalid", "name_too_long", "no_ticket_types"].sort(),
    );
    expect(result.violations.every((v) => v.personIndex !== null)).toBe(true);
  });
});

describe("validateOrder — derivation matches the current line-item builder", () => {
  it("a two-person, three-ticket order groups into the right per-type counts", () => {
    const people: OrderPerson[] = [
      { name: "Alice Lead", email: "alice@example.com", ticketTypeIds: ["friday", "saturday"] },
      { name: "Bob Guest", email: "bob@example.com", ticketTypeIds: ["friday"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(true);

    const counts = deriveTicketCounts(people);
    expect(counts.get("friday")).toBe(2);
    expect(counts.get("saturday")).toBe(1);
    expect(counts.size).toBe(2);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("validateOrder — a person with no ticket types is refused", () => {
  it("flags no_ticket_types on that person's ticketTypeIds field", () => {
    const people: OrderPerson[] = [
      { name: "Empty Handed", email: "empty@example.com", ticketTypeIds: [] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const dupes = violation(result, "no_ticket_types");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].personIndex).toBe(0);
    expect(dupes[0].field).toBe("ticketTypeIds");
  });
});

describe("validateOrder — maxTicketsPerPerson (one ticket per head)", () => {
  const ONE_EACH: OrderBounds = { maxPeople: 20, maxTickets: 20, maxTicketsPerPerson: 1 };

  it("accepts one ticket per person", () => {
    const people: OrderPerson[] = [
      { name: "John Smith", email: "john@example.com", ticketTypeIds: ["day1"] },
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day2"] },
    ];
    expect(validateOrder(people, ONE_EACH).ok).toBe(true);
  });

  it("refuses a person holding two types, pinned to that person's row", () => {
    const people: OrderPerson[] = [
      { name: "John Smith", email: "john@example.com", ticketTypeIds: ["day1"] },
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day1", "day2"] },
    ];
    const result = validateOrder(people, ONE_EACH);
    expect(result.ok).toBe(false);
    const hits = violation(result, "too_many_ticket_types_for_person");
    expect(hits).toHaveLength(1);
    expect(hits[0].personIndex).toBe(1);
    expect(hits[0].field).toBe("ticketTypeIds");
    expect(hits[0].message).toBe("Each person can hold one ticket");
  });

  it("reports the bound once per offending person, not once per excess ticket", () => {
    const people: OrderPerson[] = [
      { name: "John Smith", email: "john@example.com", ticketTypeIds: ["a", "b", "c", "d"] },
    ];
    expect(violation(validateOrder(people, ONE_EACH), "too_many_ticket_types_for_person")).toHaveLength(1);
  });

  it("does not fire for an empty holding — that is no_ticket_types' job, and only one fires", () => {
    const people: OrderPerson[] = [{ name: "Empty Handed", email: "e@example.com", ticketTypeIds: [] }];
    const result = validateOrder(people, ONE_EACH);
    expect(violation(result, "too_many_ticket_types_for_person")).toHaveLength(0);
    expect(violation(result, "no_ticket_types")).toHaveLength(1);
  });

  it("is unbounded when the caller omits it (the multi-day shape stays representable)", () => {
    const people: OrderPerson[] = [
      { name: "John Smith", email: "john@example.com", ticketTypeIds: ["day1", "day2"] },
    ];
    expect(validateOrder(people, BOUNDS).ok).toBe(true);
  });

  it("honours a bound above 1", () => {
    const two: OrderBounds = { maxPeople: 20, maxTickets: 20, maxTicketsPerPerson: 2 };
    const ok: OrderPerson[] = [{ name: "John Smith", email: "j@example.com", ticketTypeIds: ["a", "b"] }];
    const tooMany: OrderPerson[] = [{ name: "John Smith", email: "j@example.com", ticketTypeIds: ["a", "b", "c"] }];
    expect(validateOrder(ok, two).ok).toBe(true);
    const hits = violation(validateOrder(tooMany, two), "too_many_ticket_types_for_person");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toBe("Each person can hold at most 2 tickets");
  });
});

describe("validateOrder — bounds and length caps (each refused independently)", () => {
  it("an order past the people bound is refused, order-scoped", () => {
    const tight: OrderBounds = { maxPeople: 1, maxTickets: 20 };
    const people: OrderPerson[] = [
      { name: "One Person", email: "one@example.com", ticketTypeIds: ["day1"] },
      { name: "Two Person", email: "two@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, tight);
    expect(result.ok).toBe(false);
    const tooMany = violation(result, "too_many_people");
    expect(tooMany).toHaveLength(1);
    expect(tooMany[0].personIndex).toBeNull();
    expect(tooMany[0].field).toBeNull();
  });

  it("an order past the derived ticket bound is refused, order-scoped", () => {
    const tight: OrderBounds = { maxPeople: 20, maxTickets: 1 };
    const people: OrderPerson[] = [
      { name: "One Person", email: "one@example.com", ticketTypeIds: ["day1", "day2"] },
    ];
    const result = validateOrder(people, tight);
    expect(result.ok).toBe(false);
    const tooMany = violation(result, "too_many_tickets");
    expect(tooMany).toHaveLength(1);
    expect(tooMany[0].personIndex).toBeNull();
    expect(tooMany[0].field).toBeNull();
  });

  it("an over-length name is refused", () => {
    const people: OrderPerson[] = [
      { name: `${"X".repeat(70)} ${"Y".repeat(70)}`, email: "long@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const tooLong = violation(result, "name_too_long");
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0].personIndex).toBe(0);
    expect(tooLong[0].field).toBe("name");
  });

  it("an over-length email is refused", () => {
    const localPart = "a".repeat(250);
    const people: OrderPerson[] = [
      { name: "Long Email", email: `${localPart}@example.com`, ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const tooLong = violation(result, "email_too_long");
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0].personIndex).toBe(0);
    expect(tooLong[0].field).toBe("email");
  });
});

describe("validateOrder — order-scoped violations carry no person and no field", () => {
  it("empty_order carries neither personIndex nor field", () => {
    const result = validateOrder([], BOUNDS);
    expect(result.ok).toBe(false);
    const empty = violation(result, "empty_order");
    expect(empty).toHaveLength(1);
    expect(empty[0].personIndex).toBeNull();
    expect(empty[0].field).toBeNull();
  });
});

describe("validateOrder — additional edge cases", () => {
  it("a whitespace-only name is refused as missing, not accepted as a name", () => {
    const people: OrderPerson[] = [
      { name: "   ", email: "blank@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    expect(violation(result, "name_required")).toHaveLength(1);
  });

  it("a single-word name is refused for lacking a first and last name", () => {
    const people: OrderPerson[] = [
      { name: "Madonna", email: "madonna@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    const needsFullName = violation(result, "name_needs_first_and_last");
    expect(needsFullName).toHaveLength(1);
    expect(needsFullName[0].field).toBe("name");
  });

  it("a missing email is refused", () => {
    const people: OrderPerson[] = [
      { name: "No Email", email: "", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(false);
    expect(violation(result, "email_required")).toHaveLength(1);
  });

  it("an unknown ticket type is refused when the caller supplies a known-type check", () => {
    const people: OrderPerson[] = [
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["day1", "not-in-basket"] },
    ];
    const result = validateOrder(people, BOUNDS, (id) => id === "day1");
    expect(result.ok).toBe(false);
    const unknown = violation(result, "unknown_ticket_type");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].personIndex).toBe(0);
  });

  it("no unknown-type check is applied when the caller omits it", () => {
    const people: OrderPerson[] = [
      { name: "Jane Doe", email: "jane@example.com", ticketTypeIds: ["anything-goes"] },
    ];
    const result = validateOrder(people, BOUNDS);
    expect(result.ok).toBe(true);
  });

  it("exactly at the people and ticket bounds is accepted, not refused", () => {
    const bounds: OrderBounds = { maxPeople: 2, maxTickets: 2 };
    const people: OrderPerson[] = [
      { name: "One Person", email: "one@example.com", ticketTypeIds: ["day1"] },
      { name: "Two Person", email: "two@example.com", ticketTypeIds: ["day1"] },
    ];
    const result = validateOrder(people, bounds);
    expect(result.ok).toBe(true);
  });
});

describe("identity keys", () => {
  it("personIdentityKey case-folds the name and lowercases the email", () => {
    expect(personIdentityKey("Jane   Doe", "Jane@Example.com")).toBe(
      personIdentityKey("jane doe", "jane@example.com"),
    );
  });

  it("ticketIdentityKey scopes the person key to a ticket type", () => {
    const friday = ticketIdentityKey("Jane Doe", "jane@example.com", "friday");
    const saturday = ticketIdentityKey("Jane Doe", "jane@example.com", "saturday");
    expect(friday).not.toBe(saturday);
  });
});

describe("deriveTicketCounts", () => {
  it("an empty order derives no counts", () => {
    expect(deriveTicketCounts([]).size).toBe(0);
  });
});
