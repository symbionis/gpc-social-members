import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "@/app/api/admin/events/[id]/attendees/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

type Row = Record<string, unknown>;

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

/**
 * Admin-client mock. `.eq`, `.in`, and `.is` all record real filters and are applied
 * to the row-returning tables — the route's correctness now depends on all three
 * (`slot_status IN (issued, claimed)`, `released_at IS NULL`), so a mock that
 * no-ops them would let a broken query pass.
 */
function adminClient(opts: {
  admins: { id: string; role: string }[];
  event: Row | null;
  tickets: Row[];
  registrations?: Row[];
  items?: Row[];
  ticketTypes?: Row[];
  members?: Row[];
}) {
  return {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      const iss: Array<[string, unknown]> = [];
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, val: unknown) => {
        eqs.push([col, val]);
        return c;
      };
      c.in = (col: string, vals: unknown[]) => {
        ins.push([col, vals]);
        return c;
      };
      c.is = (col: string, val: unknown) => {
        iss.push([col, val]);
        return c;
      };
      c.limit = () => c;
      c.order = () => c;
      c.single = async () => ({
        data: opts.event,
        error: opts.event ? null : { message: "not found" },
      });
      const filtered = (rows: Row[]) => {
        let out = rows;
        for (const [col, val] of eqs) out = out.filter((r) => r[col] === val);
        for (const [col, vals] of ins) out = out.filter((r) => vals.includes(r[col]));
        for (const [col, val] of iss) out = out.filter((r) => (r[col] ?? null) === val);
        return out;
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: opts.admins, error: null });
        if (table === "tickets") return resolve({ data: filtered(opts.tickets), error: null });
        if (table === "event_registrations")
          return resolve({ data: filtered(opts.registrations ?? []), error: null });
        if (table === "event_registration_items")
          return resolve({ data: opts.items ?? [], error: null });
        if (table === "event_ticket_types")
          return resolve({ data: opts.ticketTypes ?? [], error: null });
        if (table === "members") return resolve({ data: opts.members ?? [], error: null });
        return resolve({ data: [], error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const HEADER =
  "booking_ref,last_name,first_name,ticket_type,email,phone,is_member,party_lead,tickets,waiver,arrived,cancelled";

/** The header is line 1 — the sheet has no TOTALS block above it any more. */
function sheet(csv: string) {
  const all = csv.split("\n");
  return { header: all[0], rows: all.slice(1).filter(Boolean) };
}

function get(eventId = "evt-1", format = "csv") {
  const req = new Request(
    `http://localhost/api/admin/events/${eventId}/attendees?format=${format}`
  );
  return GET(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];
// Past-dated: padding on a *future* event warns (a real minting bug), and we don't
// want that noise in fixtures that deliberately exercise the legacy padding path.
const event = { id: "evt-1", title: "Summer Polo", start_date: "2026-06-06" };

/** A claimed ticket row, with the fields the fixtures vary spread over the top. */
function ticket(over: Row): Row {
  return {
    event_id: "evt-1",
    registration_id: null,
    member_id: null,
    name: null,
    email: null,
    phone_e164: null,
    is_lead: false,
    slot_status: "claimed",
    ticket_type_id: null,
    released_at: null,
    waiver_accepted_at: null,
    checked_in_at: null,
    created_at: "2026-06-01T08:00:00Z",
    ...over,
  };
}

/** A paid registration, with the fields the fixtures vary spread over the top. */
function reg(over: Row): Row {
  return {
    event_id: "evt-1",
    status: "paid",
    quantity: 1,
    reference_code: null,
    name: null,
    email: null,
    phone_e164: null,
    member_id: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("GET /api/admin/events/[id]/attendees (CSV)", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, event, tickets: [] })
    );
    expect((await get()).status).toBe(401);
  });

  it("403s a non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: [], event, tickets: [] })
    );
    expect((await get()).status).toBe(403);
  });

  it("400s without format=csv", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, event, tickets: [] })
    );
    expect((await get("evt-1", "json")).status).toBe(400);
  });

  it("exports every ticket the party bought, named or not", async () => {
    // A party of 5: the lead and one guest pre-registered; the other 3 tickets were
    // never claimed. All 5 must print — the unclaimed ones as blank, tickable lines
    // that still carry the ticket type catering needs.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({
            registration_id: "r1",
            member_id: "m1",
            name: "Ann Lead",
            email: "ann@x.com",
            phone_e164: "+41781234567",
            is_lead: true,
            ticket_type_id: "tt-std",
            waiver_accepted_at: "2026-06-01T09:00:00Z",
            checked_in_at: "2026-06-06T10:00:00Z",
          }),
          ticket({
            registration_id: "r1",
            name: "Bo Guest",
            email: "bo@x.com",
            ticket_type_id: "tt-veg",
            created_at: "2026-06-01T08:05:00Z",
          }),
          // Minted, never claimed: no person, but its ticket type is known.
          ticket({
            registration_id: "r1",
            slot_status: "issued",
            ticket_type_id: "tt-std",
            created_at: "2026-06-01T08:06:00Z",
          }),
        ],
        registrations: [
          reg({
            id: "r1",
            status: "paid",
            quantity: 5,
            reference_code: "EV-AB12",
            name: "Ann Lead",
            email: "ann@x.com",
            phone_e164: "+41781234567",
            member_id: "m1",
          }),
        ],
        items: [
          { registration_id: "r1", ticket_type_id: "tt-std", title_snapshot: "Asado Standard", quantity: 4 },
          { registration_id: "r1", ticket_type_id: "tt-veg", title_snapshot: "Asado Vegetarian", quantity: 1 },
        ],
        ticketTypes: [
          { id: "tt-std", title: "Asado Standard" },
          { id: "tt-veg", title: "Asado Vegetarian" },
        ],
        // The lead is member m1 → authoritative "Leader", not the heuristic "Lead" the
        // single `name` string would yield. Proves the members join wins.
        members: [{ id: "m1", first_name: "Ann", last_name: "Leader" }],
      })
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attendees-summer-polo-");

    const { header, rows } = sheet(await res.text());
    expect(header).toBe(HEADER);
    // 5 tickets sold → 5 lines, regardless of who pre-registered.
    expect(rows).toHaveLength(5);
    // Flat A–Z: guest "Guest,Bo" sorts ahead of lead "Leader,Ann" (G < L), so on the
    // flat sheet the guest is row 0 and the lead row 1 — that is the whole point.
    // Named guest: heuristic split, own ticket type, attributed to the lead.
    expect(rows[0]).toBe(
      "EV-AB12,Guest,Bo,Asado Vegetarian,bo@x.com,,no,guest of Ann Lead,,unsigned,no,"
    );
    // Lead: member's authoritative name, party quantity, signed waiver, arrived. The
    // E.164 phone's leading + is neutralized against formula injection.
    expect(rows[1]).toBe(
      "EV-AB12,Leader,Ann,Asado Standard,ann@x.com,'+41781234567,yes,lead,5,signed,yes,"
    );
    // The issued ticket + 2 padded ones: blank person, real ticket type, sorted to the
    // end (no surname). 4 Standards were bought and only 2 live rows carry Standard, so
    // the remainder is Standard.
    expect(rows[2]).toBe("EV-AB12,,,Asado Standard,,,,guest of Ann Lead,,,,");
    expect(rows[3]).toBe("EV-AB12,,,Asado Standard,,,,guest of Ann Lead,,,,");
    expect(rows[4]).toBe("EV-AB12,,,Asado Standard,,,,guest of Ann Lead,,,,");
  });

  it("orders everyone by surname globally, not by purchase time", async () => {
    // Zimmer bought first, Ace second. A creation-time sort would print Zoe first;
    // the sheet must print Ace first so a door staffer can scan surnames A→Z. (Here
    // Zimmer sorts after all of Ace's people either way — the cross-party interleaving
    // proof is the next test.)
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({
            registration_id: "rZ",
            name: "Zoe Zimmer",
            is_lead: true,
            created_at: "2026-06-01T08:00:00Z",
          }),
          // Two named guests, deliberately out of alphabetical order in the input.
          ticket({
            registration_id: "rA",
            name: "Wes Wolf",
            created_at: "2026-06-01T09:30:00Z",
          }),
          ticket({
            registration_id: "rA",
            name: "Ann Ace",
            is_lead: true,
            created_at: "2026-06-01T09:00:00Z",
          }),
          ticket({
            registration_id: "rA",
            name: "Cy Crow",
            created_at: "2026-06-01T09:15:00Z",
          }),
        ],
        registrations: [
          reg({ id: "rZ", status: "paid", quantity: 1, reference_code: "EV-ZZZZ", name: "Zoe Zimmer" }),
          reg({ id: "rA", status: "paid", quantity: 3, reference_code: "EV-AAAA", name: "Ann Ace" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    const cells = rows.map((r) => r.split(","));
    // Ace, Crow, Wolf (Ace's party, alphabetised globally), then Zimmer.
    expect(cells.map((c) => c[1])).toEqual(["Ace", "Crow", "Wolf", "Zimmer"]);
    expect(cells.map((c) => c[0])).toEqual([
      "EV-AAAA",
      "EV-AAAA",
      "EV-AAAA",
      "EV-ZZZZ",
    ]);
  });

  it("interleaves guests from different parties into one A–Z list", async () => {
    // The proof the sheet is flat, not grouped: Smith's guest "Adams" sorts to the TOP
    // by her own surname — above solo lead "Brown" and above her own lead "Smith". On the
    // old party-grouped sheet she'd sit beneath Smith near the bottom.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "rS", name: "Sam Smith", is_lead: true }),
          ticket({ registration_id: "rS", name: "Jane Adams" }),
          ticket({ registration_id: "rB", name: "Amir Brown", is_lead: true }),
        ],
        registrations: [
          reg({ id: "rS", status: "paid", quantity: 2, reference_code: "EV-S", name: "Sam Smith" }),
          reg({ id: "rB", status: "paid", quantity: 1, reference_code: "EV-B", name: "Amir Brown" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    const cells = rows.map((r) => r.split(","));
    expect(cells.map((c) => c[1])).toEqual(["Adams", "Brown", "Smith"]);
    // Adams keeps her lead's booking ref and "guest of" label even sorted away from him.
    expect(cells[0][0]).toBe("EV-S");
    expect(cells[0][7]).toBe("guest of Sam Smith");
  });

  it("sorts a named one-word name above the blank fill-in lines", async () => {
    // "Madonna" has no surname, so she sorts into the tail with the blanks — but she is a
    // real, named guest, so the `named` tiebreak keeps her ABOVE the unnamed line (and
    // thus above the printed "To fill in" divider), never mistaken for a slot to fill.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "r1", name: "Ann Ace", is_lead: true }),
          ticket({ registration_id: "r1", name: "Madonna" }),
        ],
        registrations: [
          reg({ id: "r1", status: "paid", quantity: 3, reference_code: "EV-M", name: "Ann Ace" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    expect(rows).toHaveLength(3);
    expect(rows[0].split(",")[1]).toBe("Ace"); // surname-bearing lead first
    // Named one-word name next — above the blank, not among it: last empty, first "Madonna".
    expect(rows[1].split(",").slice(1, 3)).toEqual(["", "Madonna"]);
    // The unnamed padded line sorts last.
    expect(rows[2].split(",").slice(1, 3)).toEqual(["", ""]);
  });

  it("rebuilds a missing lead from the purchase record", async () => {
    // A legacy party: tickets were sold but no ticket rows were ever minted. The
    // registration still knows who bought it, so the party gets a real, sortable lead
    // and its remaining ticket prints as a blank line — never an anonymous party.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [],
        registrations: [
          reg({
            id: "rL",
            status: "paid",
            quantity: 2,
            reference_code: "EV-1104",
            name: "Anna Schmidt",
            email: "anna@x.com",
            phone_e164: "+41797778899",
            member_id: null,
          }),
        ],
        items: [
          { registration_id: "rL", ticket_type_id: "tt-std", title_snapshot: "Asado Standard", quantity: 1 },
          { registration_id: "rL", ticket_type_id: "tt-veg", title_snapshot: "Asado Vegetarian", quantity: 1 },
        ],
        ticketTypes: [
          { id: "tt-std", title: "Asado Standard" },
          { id: "tt-veg", title: "Asado Vegetarian" },
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    expect(rows).toHaveLength(2);
    // The reconstructed lead carries contact + quantity, but blank waiver/arrived:
    // there is no ticket row to read those from, so the sheet must not claim she is
    // unsigned — only that it does not know.
    expect(rows[0]).toBe(
      "EV-1104,Schmidt,Anna,Asado Standard,anna@x.com,'+41797778899,no,lead,2,,,"
    );
    // Her unsold-to-a-name second ticket, typed from the purchase record.
    expect(rows[1]).toBe("EV-1104,,,Asado Vegetarian,,,,guest of Anna Schmidt,,,,");
  });

  it("resolves a reconstructed lead's name from the members table", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [],
        registrations: [
          reg({
            id: "rM",
            status: "paid",
            quantity: 1,
            reference_code: "EV-MMMM",
            name: "Ann Lead",
            member_id: "m1",
          }),
        ],
        members: [{ id: "m1", first_name: "Ann", last_name: "Leader" }],
      })
    );
    const { rows } = sheet(await (await get()).text());
    // "Leader" (authoritative), not "Lead" (the heuristic split of the reg's name).
    expect(rows[0].split(",")[1]).toBe("Leader");
    expect(rows[0].split(",")[6]).toBe("yes"); // is_member
  });

  it("excludes released and legacy-unclaimed tickets", async () => {
    // A released ticket is re-minted as a fresh issued row, so counting it would
    // double-book the party. A legacy 'unclaimed' row is not a sold ticket at all —
    // on a sheet that admits people, an unrecognized status must fall OFF the roster.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "r1", name: "Real Lead", is_lead: true }),
          ticket({ registration_id: "r1", slot_status: "issued", released_at: "2026-06-02T00:00:00Z" }),
          ticket({ registration_id: "r1", slot_status: "unclaimed" }),
        ],
        registrations: [
          reg({ id: "r1", status: "paid", quantity: 1, reference_code: "EV-R1", name: "Real Lead" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    expect(rows).toHaveLength(1);
    expect(rows[0].startsWith("EV-R1,Lead,Real,")).toBe(true);
  });

  it("never emits a credential token", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({
            registration_id: "r1",
            name: "Ann Ace",
            is_lead: true,
            credential_token: "SECRET-QR-TOKEN",
          }),
        ],
        registrations: [
          reg({ id: "r1", status: "paid", quantity: 1, reference_code: "EV-R1", name: "Ann Ace" }),
        ],
      })
    );
    const csv = await (await get()).text();
    expect(csv).not.toContain("SECRET-QR-TOKEN");
  });

  it("files an ops-imported ticket under its own surname", async () => {
    // Bulk-imported attendees belong to no registration. Each is its own one-person
    // party and must still file alphabetically among the leads, not fall to the end.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "rZ", name: "Zoe Zimmer", is_lead: true }),
          ticket({ registration_id: null, name: "Mia Marsh", phone_e164: "+390612345678" }),
        ],
        registrations: [
          reg({ id: "rZ", status: "paid", quantity: 1, reference_code: "EV-ZZZZ", name: "Zoe Zimmer" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    // Marsh before Zimmer; no booking ref, no party, phone's + neutralized.
    expect(rows[0]).toBe(",Marsh,Mia,,,'+390612345678,no,,,unsigned,no,");
    expect(rows[1].split(",")[1]).toBe("Zimmer");
  });

  it("neutralizes a formula-injection name (leading =)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [ticket({ name: "=SUM(A1:A9)", email: "x@x.com", is_lead: true })],
      })
    );
    const { rows } = sheet(await (await get()).text());
    // Single-token name → all first name, empty last name. The leading = is quoted.
    expect(rows[0].startsWith(",,'=SUM(A1:A9),")).toBe(true);
  });

  it("does not truncate a party whose live rows exceed its quantity", async () => {
    // Over-claim drift: losing a real ticket from the sheet is worse than printing an
    // over-long party block, so every live row still prints and nothing pads.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "r1", name: "Ann Ace", is_lead: true }),
          ticket({ registration_id: "r1", name: "Bo Bay" }),
          ticket({ registration_id: "r1", name: "Cy Crow" }),
        ],
        registrations: [
          reg({ id: "r1", status: "paid", quantity: 2, reference_code: "EV-R1", name: "Ann Ace" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    expect(rows).toHaveLength(3);
  });

  it("prints one line per ticket sold across the whole event", async () => {
    // The single strongest guard for the sheet's purpose: rows == Σ max(quantity,
    // live rows) + registration-less tickets. If a ticket ever falls off the sheet
    // again, this fails.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        tickets: [
          ticket({ registration_id: "r1", name: "Ann Ace", is_lead: true }),
          ticket({ registration_id: "r1", slot_status: "issued" }),
          ticket({ registration_id: "r2", name: "Bo Bay", is_lead: true }),
          ticket({ registration_id: null, name: "Ops Import" }),
        ],
        registrations: [
          reg({ id: "r1", status: "paid", quantity: 4, reference_code: "EV-R1", name: "Ann Ace" }),
          reg({ id: "r2", status: "free", quantity: 3, reference_code: "EV-R2", name: "Bo Bay" }),
          // Legacy: sold, but no ticket rows at all.
          reg({ id: "r3", status: "paid", quantity: 2, reference_code: "EV-R3", name: "Cy Crow" }),
        ],
      })
    );
    const { rows } = sheet(await (await get()).text());
    // 4 + 3 + 2 tickets sold, plus the 1 ops-imported attendee.
    expect(rows).toHaveLength(10);
  });

  it("exports a well-formed sheet for an event with no registrations", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, event, tickets: [] })
    );
    const res = await get();
    expect(res.status).toBe(200);
    const { header, rows } = sheet(await res.text());
    expect(header).toBe(HEADER);
    expect(rows).toEqual([]);
  });

  it("500s rather than exporting a partial sheet when a query fails", async () => {
    const broken = {
      from: () => {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.in = () => c;
        c.is = () => c;
        c.limit = () => c;
        c.order = () => c;
        c.single = async () => ({ data: event, error: null });
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: null, error: { message: "boom" } });
        return c;
      },
    } as unknown as ReturnType<typeof createAdminClient>;
    // admin_users must still resolve, or we 403 before reaching the roster query.
    const realFrom = broken.from;
    (broken as { from: unknown }).from = (table: string) => {
      if (table === "admin_users") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: superAdmin, error: null });
        return c;
      }
      return (realFrom as (t: string) => unknown)(table);
    };
    mockedCreateAdminClient.mockReturnValue(broken);
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load attendees for export" });
  });
});
