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
 * Admin-client mock: `admin_users` resolves the supplied admins; `events`
 * resolves the supplied event via `.single()`; `event_attendees` resolves the
 * supplied roster rows (with .eq filters applied).
 */
function adminClient(opts: {
  admins: { id: string; role: string }[];
  event: Row | null;
  attendees: Row[];
  registrations?: Row[];
  items?: Row[];
  ticketTypes?: Row[];
  members?: Row[];
}) {
  return {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, val: unknown) => {
        eqs.push([col, val]);
        return c;
      };
      c.in = () => c;
      c.is = () => c;
      c.limit = () => c;
      c.order = () => c;
      c.single = async () => ({ data: opts.event, error: opts.event ? null : { message: "not found" } });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: opts.admins, error: null });
        if (table === "event_attendees") {
          let rows = opts.attendees;
          for (const [col, val] of eqs) rows = rows.filter((r) => r[col] === val);
          return resolve({ data: rows, error: null });
        }
        if (table === "event_registrations") {
          return resolve({ data: opts.registrations ?? [], error: null });
        }
        if (table === "event_registration_items") {
          return resolve({ data: opts.items ?? [], error: null });
        }
        if (table === "event_ticket_types") {
          return resolve({ data: opts.ticketTypes ?? [], error: null });
        }
        if (table === "members") {
          return resolve({ data: opts.members ?? [], error: null });
        }
        return resolve({ data: [], error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

/**
 * Split the CSV into its top TOTALS block and the roster below. The two sections
 * are separated by a single blank line: [TOTALS, ...totals, "", header, ...rows].
 */
function sections(csv: string) {
  const all = csv.split("\n");
  const blank = all.indexOf("");
  return {
    totals: all.slice(0, blank),
    header: all[blank + 1],
    rows: all.slice(blank + 2),
  };
}

function get(eventId = "evt-1", format = "csv") {
  const req = new Request(
    `http://localhost/api/admin/events/${eventId}/attendees?format=${format}`
  );
  return GET(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];
const event = { id: "evt-1", title: "Summer Polo", start_date: "2026-06-06" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("GET /api/admin/events/[id]/attendees (CSV)", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, event, attendees: [] })
    );
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("403s a non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: [], event, attendees: [] })
    );
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("400s without format=csv", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, event, attendees: [] })
    );
    const res = await get("evt-1", "json");
    expect(res.status).toBe(400);
  });

  it("exports the roster columns from event_attendees", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        attendees: [
          {
            event_id: "evt-1",
            registration_id: "r1",
            member_id: "m1",
            name: "Ann Lead",
            email: "ann@x.com",
            phone_e164: "+41781234567",
            is_lead: true,
            slot_status: "claimed",
            waiver_accepted_at: "2026-06-01T09:00:00Z",
            checked_in_at: "2026-06-06T10:00:00Z",
            created_at: "2026-06-01T08:00:00Z",
          },
          {
            event_id: "evt-1",
            registration_id: "r1",
            member_id: null,
            name: "Bo Guest",
            email: "bo@x.com",
            phone_e164: null,
            is_lead: false,
            slot_status: "claimed",
            ticket_type_id: "tt-veg",
            waiver_accepted_at: null,
            checked_in_at: null,
            created_at: "2026-06-01T08:05:00Z",
          },
        ],
        registrations: [{ id: "r1", quantity: 5, reference_code: "EV-AB12" }],
        items: [
          { registration_id: "r1", title_snapshot: "Asado Standard", quantity: 4 },
          { registration_id: "r1", title_snapshot: "Asado Vegetarian", quantity: 1 },
        ],
        ticketTypes: [{ id: "tt-veg", title: "Asado Vegetarian" }],
        // The lead is member m1 → authoritative last name "Leader" (not the heuristic
        // "Lead" the single `name` string would yield), proving the members join wins.
        members: [{ id: "m1", first_name: "Ann", last_name: "Leader" }],
      })
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(
      "attendees-summer-polo-"
    );
    const { totals, header, rows } = sections(await res.text());
    // Top-of-sheet totals: total tickets sold + a count per ticket type, from the
    // purchased registration items (right even before everyone has pre-registered).
    expect(totals).toEqual([
      "TOTALS",
      "Total tickets,5",
      "Asado Standard,4",
      "Asado Vegetarian,1",
    ]);
    expect(header).toBe(
      "booking_ref,last_name,first_name,email,phone,is_member,party_lead,tickets,party_registered,party_remaining,ticket_types,ticket_type,waiver,arrived,arrived_at"
    );
    // Lead: booking ref, member's authoritative last/first, signed waiver, arrived;
    // party tickets + breakdown attributed here. 2 of the 5 tickets are pre-registered
    // (lead + 1 guest), so 3 remain. The lead has no per-person ticket type yet → empty
    // ticket_type cell. The E.164 phone's leading + is neutralized (leading '); the
    // comma-bearing breakdown is quote-wrapped.
    expect(rows[0]).toBe(
      'EV-AB12,Leader,Ann,ann@x.com,\'+41781234567,yes,lead,5,2 of 5,3,"4 × Asado Standard, 1 × Asado Vegetarian",,signed,yes,2026-06-06T10:00:00Z'
    );
    // Guest (non-member) → single "Full name" split heuristically: last token = last
    // name. Shares the party's booking ref; no party tickets or fill counts (the lead
    // carries those) but the guest's own ticket type fills the per-person column.
    expect(rows[1]).toBe(
      "EV-AB12,Guest,Bo,bo@x.com,,no,guest of Ann Lead,,,,,Asado Vegetarian,unsigned,no,"
    );
  });

  it("renders a phone-only attendee without dropping it", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        attendees: [
          {
            event_id: "evt-1",
            registration_id: null,
            member_id: null,
            name: "Phone Only",
            email: null,
            phone_e164: "+390612345678",
            is_lead: false,
            slot_status: "claimed",
            waiver_accepted_at: null,
            checked_in_at: null,
            created_at: "2026-06-01T08:00:00Z",
          },
        ],
      })
    );
    const res = await get();
    const { rows } = sections(await res.text());
    // E.164 phone's leading + is quote-neutralized; "Phone Only" splits to last/first
    // (Only/Phone); no party → empty booking ref, ticket, and fill cells; not dropped.
    expect(rows[0]).toBe(",Only,Phone,,'+390612345678,no,,,,,,,unsigned,no,");
  });

  it("neutralizes a formula-injection name (leading =)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        event,
        attendees: [
          {
            event_id: "evt-1",
            registration_id: null,
            member_id: null,
            name: "=SUM(A1:A9)",
            email: "x@x.com",
            phone_e164: null,
            is_lead: true,
            slot_status: "claimed",
            waiver_accepted_at: null,
            checked_in_at: null,
            created_at: "2026-06-01T08:00:00Z",
          },
        ],
      })
    );
    const res = await get();
    const { rows } = sections(await res.text());
    // Single-token name → all first name, empty last name. Empty booking_ref and
    // last_name lead the row (two commas); the first_name's leading = is then
    // neutralized with a leading ' (no comma, so no quote-wrapping).
    expect(rows[0].startsWith(`,,'=SUM(A1:A9),`)).toBe(true);
  });
});
