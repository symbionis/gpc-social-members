import { describe, it, expect } from "vitest";
import {
  parseGuestNames,
  parseLeadInput,
  parseGuestsInput,
  suppliedTicketTypeIds,
  mapCompRpcError,
  mentionsTicketType,
  DUPLICATE_LEAD_MESSAGE,
} from "@/lib/events/guest-list";

describe("parseGuestNames", () => {
  it("parses one name per line", () => {
    const { rows, errors } = parseGuestNames("Jane Doe\nMarco Rossi\nAnna Bianchi");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 1, name: "Jane Doe" });
    expect(rows[2]).toMatchObject({ line: 3, name: "Anna Bianchi" });
  });

  it("skips blank and all-whitespace lines but keeps original line numbers", () => {
    const { rows, errors } = parseGuestNames("Jane Doe\n\n   \nJohn Roe");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].line).toBe(1);
    expect(rows[1].line).toBe(4);
  });

  it("trims surrounding whitespace and collapses inner runs", () => {
    const { rows } = parseGuestNames("   Jane    Doe   ");
    expect(rows[0].name).toBe("Jane Doe");
  });

  it("takes the first column of a pasted comma-separated row", () => {
    const { rows, errors } = parseGuestNames("Jane Doe, CH, 078 123 45 67");
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe("Jane Doe");
  });

  it("reports a row with content but no name (leading comma)", () => {
    const { rows, errors } = parseGuestNames("Jane Doe\n, CH, 078 123 45 67");
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 2, reason: "Missing name" });
    expect(errors[0].raw).toBe(", CH, 078 123 45 67");
  });

  it("reports an implausibly long name rather than storing it", () => {
    const { rows, errors } = parseGuestNames("x".repeat(130));
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toMatch(/too long/i);
  });

  it("handles CRLF input", () => {
    const { rows } = parseGuestNames("Jane Doe\r\nJohn Roe");
    expect(rows.map((r) => r.name)).toEqual(["Jane Doe", "John Roe"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseGuestNames("")).toEqual({ rows: [], errors: [] });
  });
});

describe("parseLeadInput", () => {
  it("accepts a lead with a name, email and ticket type", () => {
    const res = parseLeadInput({ name: " Astrid Ferrari ", email: "Astrid@X.ch", ticketTypeId: "tt-1" });
    expect(res).toEqual({
      ok: true,
      value: { name: "Astrid Ferrari", email: "astrid@x.ch", ticket_type_id: "tt-1", phone_e164: null },
    });
  });

  it("carries an optional phone", () => {
    const res = parseLeadInput({ name: "A", email: "a@x.ch", ticketTypeId: "tt-1", phone: "+41791112233" });
    expect(res.ok && res.value.phone_e164).toBe("+41791112233");
  });

  it("rejects a lead with no email", () => {
    const res = parseLeadInput({ name: "A", ticketTypeId: "tt-1" });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/email/i);
  });

  it("rejects a malformed lead email", () => {
    const res = parseLeadInput({ name: "A", email: "not-an-email", ticketTypeId: "tt-1" });
    expect(res.ok === false && res.error).toMatch(/email/i);
  });

  it("rejects a lead with no name", () => {
    const res = parseLeadInput({ name: "  ", email: "a@x.ch", ticketTypeId: "tt-1" });
    expect(res.ok === false && res.error).toMatch(/name/i);
  });

  it("rejects a lead with no ticket type", () => {
    const res = parseLeadInput({ name: "A", email: "a@x.ch" });
    expect(res.ok === false && res.error).toMatch(/ticket type/i);
  });

  it("rejects a non-object lead", () => {
    expect(parseLeadInput(null)).toMatchObject({ ok: false });
  });
});

describe("parseGuestsInput", () => {
  it("accepts name + ticket type only, with no contact details", () => {
    const res = parseGuestsInput([{ name: "Guest One", ticketTypeId: "tt-1" }]);
    expect(res).toEqual({
      ok: true,
      value: [{ name: "Guest One", ticket_type_id: "tt-1", email: null, phone_e164: null }],
    });
  });

  it("lowercases an optional guest email and keeps an optional phone", () => {
    const res = parseGuestsInput([
      { name: "G", ticketTypeId: "tt-2", email: "G@X.CH", phone: "+41790000000" },
    ]);
    expect(res.ok && res.value[0]).toMatchObject({ email: "g@x.ch", phone_e164: "+41790000000" });
  });

  it("treats a missing guests key as an empty list", () => {
    expect(parseGuestsInput(undefined)).toEqual({ ok: true, value: [] });
  });

  it("rejects a guest with no name", () => {
    const res = parseGuestsInput([{ name: "", ticketTypeId: "tt-1" }]);
    expect(res.ok === false && res.error).toMatch(/name/i);
  });

  it("rejects a guest with no ticket type", () => {
    const res = parseGuestsInput([{ name: "G" }]);
    expect(res.ok === false && res.error).toMatch(/ticket type/i);
  });

  it("rejects a non-array", () => {
    expect(parseGuestsInput({ name: "G" })).toMatchObject({ ok: false });
  });
});

describe("suppliedTicketTypeIds", () => {
  it("collects distinct ids from the lead and the guests", () => {
    const lead = { name: "A", email: "a@x.ch", ticket_type_id: "tt-1", phone_e164: null };
    const guests = [
      { name: "G1", ticket_type_id: "tt-1", email: null, phone_e164: null },
      { name: "G2", ticket_type_id: "tt-2", email: null, phone_e164: null },
    ];
    expect(suppliedTicketTypeIds(lead, guests)).toEqual(["tt-1", "tt-2"]);
    expect(suppliedTicketTypeIds(null, guests)).toEqual(["tt-1", "tt-2"]);
  });
});

describe("mapCompRpcError", () => {
  it("maps a 23505 unique violation to 409", () => {
    expect(mapCompRpcError({ code: "23505", message: "dup" }, "fallback")).toEqual({
      status: 409,
      message: DUPLICATE_LEAD_MESSAGE,
    });
  });

  it("maps a P0001 RAISE to a 400 carrying the server's message, prefix stripped", () => {
    const mapped = mapCompRpcError(
      {
        code: "P0001",
        message: "create_comp_guest_list: every ticket_type_id must be an active ticket type of event evt-1",
      },
      "fallback"
    );
    expect(mapped.status).toBe(400);
    expect(mapped.message).toBe(
      "every ticket_type_id must be an active ticket type of event evt-1"
    );
    expect(mentionsTicketType(mapped.message)).toBe(true);
  });

  it("maps an unknown error to a 500 carrying the fallback", () => {
    expect(mapCompRpcError({ code: "08006", message: "connection reset" }, "Could not create")).toEqual({
      status: 500,
      message: "Could not create",
    });
  });
});
