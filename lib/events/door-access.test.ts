import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { buildDoorRoster, buildNewGuestListGroups } from "@/lib/events/door-access";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type Row = Record<string, unknown>;

const EVENT = "evt-1";

/** PostgREST's default cap — the stub enforces it, so an unpaginated read truncates here too. */
const PAGE_SIZE = 1000;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a ?? 0) - Number(b ?? 0);
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/**
 * A chainable stub that actually applies the filters buildDoorRoster passes
 * (`eq` / `in` / `is` / `order` / `range`), so the fixtures can carry rows the real query is
 * meant to exclude — a released ticket, another event's row — and the test proves
 * the query, not just the projection. Each chain is awaited directly (thenable).
 *
 * `range` is enforced the way PostgREST enforces it: a read with NO range gets at most
 * PAGE_SIZE rows back, silently — which is precisely the truncation buildDoorRoster has to
 * page around.
 */
function rosterClient(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      let rows = (tables[table] ?? []).slice();
      let ranged = false;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return c;
      };
      c.in = (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col] as never));
        return c;
      };
      c.is = (col: string, val: unknown) => {
        rows = rows.filter((r) => (r[col] ?? null) === val);
        return c;
      };
      c.order = (col: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1;
        rows = rows.slice().sort((a, b) => dir * compare(a[col], b[col]));
        return c;
      };
      c.range = (from: number, to: number) => {
        ranged = true;
        rows = rows.slice(from, to + 1);
        return c;
      };
      (c as { then: unknown }).then = (
        resolve: (r: { data: unknown; error: unknown }) => unknown
      ) => resolve({ data: ranged ? rows : rows.slice(0, PAGE_SIZE), error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const ticketTypes: Row[] = [
  {
    id: "tt-adult",
    event_id: EVENT,
    title: "Adult",
    sort_order: 1,
    archived_at: null,
  },
  {
    id: "tt-kid",
    event_id: EVENT,
    title: "Child",
    sort_order: 2,
    archived_at: null,
  },
];

const registrations: Row[] = [
  {
    id: "reg-1",
    event_id: EVENT,
    reference_code: "GPC-0001",
    name: "Alice Lead",
    quantity: 3,
    status: "paid",
  },
  // A comp guest list (U1): a free registration whose lead ticket was never claimed,
  // so the party name falls back to the registration name.
  {
    id: "reg-2",
    event_id: EVENT,
    reference_code: "GPC-0002",
    name: "Sponsor Co",
    quantity: 2,
    status: "free",
  },
];

function ticket(over: Row): Row {
  return {
    event_id: EVENT,
    registration_id: "reg-1",
    name: null,
    email: null,
    phone_e164: null,
    is_lead: false,
    ticket_type_id: "tt-adult",
    checked_in_at: null,
    created_at: "2026-07-01T08:00:00Z",
    slot_status: "claimed",
    released_at: null,
    ...over,
  };
}

const tickets: Row[] = [
  ticket({
    id: "t-alice",
    name: "Alice Lead",
    email: "alice@example.com",
    phone_e164: "+41791112233",
    is_lead: true,
    checked_in_at: "2026-07-01T10:00:00Z",
  }),
  ticket({ id: "t-bob", name: "Bob Guest", email: "bob@example.com" }),
  // Unnamed open slot (a minted `issued` row) — counted in `expected`, so it must
  // show up in `notArrived` as an "Open slot" row (KTD8).
  ticket({ id: "t-open", ticket_type_id: "tt-kid", slot_status: "issued" }),
  ticket({ id: "t-comp-1", registration_id: "reg-2", name: "Comp One" }),
  ticket({
    id: "t-comp-2",
    registration_id: "reg-2",
    name: "Comp Two",
    checked_in_at: "2026-07-01T10:05:00Z",
  }),
  // Released: reopened elsewhere as a fresh issued row — must not appear anywhere.
  ticket({
    id: "t-released",
    name: "Released Guest",
    slot_status: "released",
    released_at: "2026-07-01T09:00:00Z",
  }),
  // Legacy imported rows (R9): no registration. Invisible at the door, and they must
  // not perturb the counts — including the checked-in one.
  ticket({
    id: "t-legacy-arrived",
    registration_id: null,
    name: "Legacy Arrived",
    checked_in_at: "2026-07-01T10:10:00Z",
  }),
  ticket({ id: "t-legacy", registration_id: null, name: "Legacy Pending" }),
  // Another event's ticket — the event filter must drop it.
  ticket({ id: "t-other-event", event_id: "evt-2", name: "Other Event" }),
];

beforeEach(() => vi.clearAllMocks());

describe("buildDoorRoster", () => {
  it("carries party name, reference code, ticket type and contact onto an arrival", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const { arrivals } = await buildDoorRoster(EVENT);
    expect(arrivals.find((a) => a.id === "t-alice")).toEqual({
      id: "t-alice",
      name: "Alice Lead",
      partyName: "Alice Lead",
      referenceCode: "GPC-0001",
      ticketTypeTitle: "Adult",
      email: "alice@example.com",
      phone: "+41791112233",
      arrivedAt: "2026-07-01T10:00:00Z",
    });
    // A comp party's arrival takes the registration name as its party name.
    expect(arrivals.find((a) => a.id === "t-comp-2")).toMatchObject({
      name: "Comp Two",
      partyName: "Sponsor Co",
      referenceCode: "GPC-0002",
    });
  });

  it("returns every arrival and orders them most-recent first", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const { arrivals } = await buildDoorRoster(EVENT);
    expect(arrivals.map((a) => a.id)).toEqual(["t-comp-2", "t-alice"]);
  });

  it("does not truncate: thirty checked-in tickets produce thirty arrivals", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      ticket({
        id: `t-${i}`,
        name: `Guest ${i}`,
        is_lead: i === 0,
        checked_in_at: `2026-07-01T10:${String(i).padStart(2, "0")}:00Z`,
      })
    );
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: [{ ...registrations[0], quantity: 30 }],
        tickets: many,
        event_ticket_types: ticketTypes,
      })
    );
    const roster = await buildDoorRoster(EVENT);
    expect(roster.arrivals).toHaveLength(30);
    expect(roster.arrived).toBe(30);
    expect(roster.outstanding).toBe(0);
    expect(roster.notArrived).toHaveLength(0);
  });

  it("lists named not-arrived tickets and unnamed open slots, but never a released one", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const { notArrived } = await buildDoorRoster(EVENT);
    const ids = notArrived.map((r) => r.id);
    expect(ids).toContain("t-bob");
    expect(ids).toContain("t-comp-1");
    expect(ids).not.toContain("t-released");
    expect(ids).not.toContain("t-alice");

    expect(notArrived.find((r) => r.id === "t-bob")).toMatchObject({
      name: "Bob Guest",
      partyName: "Alice Lead",
      referenceCode: "GPC-0001",
      ticketTypeTitle: "Adult",
      email: "bob@example.com",
    });
    // The open slot renders nameless, carrying its party and ticket type.
    expect(notArrived.find((r) => r.id === "t-open")).toMatchObject({
      name: null,
      partyName: "Alice Lead",
      ticketTypeTitle: "Child",
    });
  });

  it("reconciles the counts: outstanding === expected − arrived === notArrived.length", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const roster = await buildDoorRoster(EVENT);
    expect(roster.expected).toBe(5);
    expect(roster.arrived).toBe(2);
    expect(roster.outstanding).toBe(roster.expected - roster.arrived);
    expect(roster.outstanding).toBe(roster.notArrived.length);
    // A healthy event has no seat that is missing from both feeds.
    expect(roster.unaccounted).toBe(0);
  });

  it("keeps legacy imported tickets (null registration_id) out of both projections", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const { arrivals, notArrived, arrived } = await buildDoorRoster(EVENT);
    expect(arrivals.map((a) => a.id)).not.toContain("t-legacy-arrived");
    expect(notArrived.map((r) => r.id)).not.toContain("t-legacy");
    // …and they do not inflate the arrived count either.
    expect(arrived).toBe(2);
  });

  it("pages past PostgREST's 1000-row cap: 1200 tickets all reach the door", async () => {
    // A comp list has no quantity ceiling (R6), so a busy match day runs an event past 1000
    // tickets. Unpaginated, PostgREST returns 1000 rows and NO error: guests past row 1000
    // vanish from every feed and from search while `expected` keeps counting them.
    const many = Array.from({ length: 1200 }, (_, i) =>
      ticket({
        id: `t-${String(i).padStart(4, "0")}`,
        name: `Guest ${i}`,
        is_lead: i === 0,
        checked_in_at: i < 400 ? `2026-07-01T10:00:00Z` : null,
      })
    );
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: [{ ...registrations[0], quantity: 1200 }],
        tickets: many,
        event_ticket_types: ticketTypes,
      })
    );
    const roster = await buildDoorRoster(EVENT);

    expect(roster.expected).toBe(1200);
    expect(roster.arrived).toBe(400);
    expect(roster.arrivals).toHaveLength(400);
    expect(roster.notArrived).toHaveLength(800);
    expect(roster.outstanding).toBe(800);
    expect(roster.unaccounted).toBe(0);
    // The guest who would have been truncated away is present and findable.
    expect(roster.notArrived.map((r) => r.id)).toContain("t-1199");
    expect(roster.parties[0].slots).toHaveLength(1200);
  });

  it("pages the registrations read too: 1100 parties all appear", async () => {
    const manyRegs = Array.from({ length: 1100 }, (_, i) => ({
      id: `reg-${String(i).padStart(4, "0")}`,
      event_id: EVENT,
      reference_code: `GPC-${i}`,
      name: `Party ${i}`,
      quantity: 1,
      status: "paid",
    }));
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: manyRegs,
        tickets: [],
        event_ticket_types: ticketTypes,
      })
    );
    const roster = await buildDoorRoster(EVENT);
    expect(roster.parties).toHaveLength(1100);
    expect(roster.expected).toBe(1100);
  });

  it("counts a registration with NO ticket rows as unaccounted, never as phantom outstanding", async () => {
    // A legacy registration whose tickets were never minted (claim_ticket's own fallback
    // documents these): three seats in `expected`, nothing in either feed. Deriving
    // outstanding from the quantity would show "3 outstanding" over an EMPTY list, and the
    // three people would be unfindable anywhere on the console.
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: [
          {
            id: "reg-legacy",
            event_id: EVENT,
            reference_code: "GPC-0009",
            name: "Legacy Party",
            quantity: 3,
            status: "paid",
          },
        ],
        tickets: [],
        event_ticket_types: ticketTypes,
      })
    );
    const roster = await buildDoorRoster(EVENT);

    expect(roster.expected).toBe(3);
    expect(roster.arrived).toBe(0);
    expect(roster.notArrived).toHaveLength(0);
    // The number and the list agree — and the discrepancy is VISIBLE rather than hidden.
    expect(roster.outstanding).toBe(roster.notArrived.length);
    expect(roster.unaccounted).toBe(3);
  });

  it("counts a legacy 'unclaimed' slot as unaccounted (it is in neither feed)", async () => {
    // slot_status 'unclaimed' is still permitted by the CHECK constraint, and the roster
    // query only reads 'claimed' | 'issued' — so its seat is in `expected` while its row is
    // in no feed.
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: [{ ...registrations[0], quantity: 2 }],
        tickets: [
          ticket({ id: "t-named", name: "Named Guest", is_lead: true }),
          ticket({ id: "t-unclaimed", slot_status: "unclaimed" }),
        ],
        event_ticket_types: ticketTypes,
      })
    );
    const roster = await buildDoorRoster(EVENT);

    expect(roster.expected).toBe(2);
    expect(roster.notArrived.map((r) => r.id)).toEqual(["t-named"]);
    expect(roster.outstanding).toBe(1);
    expect(roster.outstanding).toBe(roster.notArrived.length);
    expect(roster.unaccounted).toBe(1);
  });

  it("shows a comp party in parties with its guests, needing no comp-specific handling", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_registrations: registrations, tickets, event_ticket_types: ticketTypes })
    );
    const { parties } = await buildDoorRoster(EVENT);
    const comp = parties.find((p) => p.registrationId === "reg-2");
    expect(comp).toMatchObject({
      referenceCode: "GPC-0002",
      leadName: "Sponsor Co",
      quantity: 2,
      claimedCount: 2,
      remaining: 0,
      complete: true,
    });
    expect(comp!.slots.map((s) => s.name)).toEqual(["Comp One", "Comp Two"]);
  });
});

/**
 * Cancelled seats: the console, the printed sheet (lib/events/door-roster.ts) and the admin
 * roster all answer "who is arriving", so they must show the same people. Check-in rejects a
 * cancelled ticket at the scan, so any seat left on the console is one the door cannot admit.
 */
describe("buildDoorRoster — cancelled seats", () => {
  const cancelledFixture = () => ({
    event_registrations: [
      { id: "reg-1", event_id: EVENT, reference_code: "GPC-0001", name: "Alice Lead", quantity: 2, status: "paid" },
      { id: "reg-refunded", event_id: EVENT, reference_code: "GPC-0009", name: "Nadia Refunded", quantity: 1, status: "paid" },
    ],
    tickets: [
      ticket({ id: "t-alice", name: "Alice Lead", email: "alice@example.com", is_lead: true }),
      ticket({ id: "t-gone", name: "Bob Cancelled", email: "bob@example.com", cancellation_status: "refunded" }),
      ticket({ id: "t-refunded", registration_id: "reg-refunded", name: "Nadia Refunded", is_lead: true, cancellation_status: "refunded" }),
    ],
    event_ticket_types: ticketTypes,
  });

  it("does not count a cancelled seat as expected", async () => {
    mockedCreateAdminClient.mockReturnValue(rosterClient(cancelledFixture()));
    const roster = await buildDoorRoster(EVENT);

    // 2 bought + 1 bought, 2 cancelled → 1 person can actually walk in.
    expect(roster.expected).toBe(1);
    expect(roster.notArrived.map((r) => r.name)).toEqual(["Alice Lead"]);
    // `outstanding === notArrived.length` holds by construction, so asserting it proves
    // nothing; this pins the claim the field actually makes.
    expect(roster.outstanding).toBe(roster.expected - roster.arrived);
    // The whole point of `unaccounted`: cancelled seats must not land in it either.
    expect(roster.unaccounted).toBe(0);
  });

  it("reports a party's size net of its cancelled seats", async () => {
    mockedCreateAdminClient.mockReturnValue(rosterClient(cancelledFixture()));
    const { parties } = await buildDoorRoster(EVENT);
    const party = parties.find((p) => p.registrationId === "reg-1")!;

    // Bought 2, one cancelled: the door must not be told a second guest is still coming,
    // nor offered a slot to fill that no longer exists.
    expect(party).toMatchObject({ quantity: 1, claimedCount: 1, remaining: 0, complete: true });
    expect(party.slots.map((s) => s.name)).toEqual(["Alice Lead"]);
  });

  it("drops a party whose every seat was cancelled", async () => {
    mockedCreateAdminClient.mockReturnValue(rosterClient(cancelledFixture()));
    const { parties, arrivals } = await buildDoorRoster(EVENT);

    expect(parties.some((p) => p.registrationId === "reg-refunded")).toBe(false);
    expect(arrivals.some((a) => a.name === "Nadia Refunded")).toBe(false);
  });

  // KD10: a guest-list ticket has no registration, so it can never attach to a party.
  // This pins that as a deliberate, known property of buildDoorRoster, not an oversight —
  // buildNewGuestListGroups (below) is the independent read that surfaces these guests.
  it("never surfaces a registration-less guest-list ticket as a party or an arrival", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_registrations: [],
        tickets: [
          {
            id: "ticket-guest-1",
            event_id: EVENT,
            registration_id: null,
            guest_list_id: "list-1",
            name: "Priya Guest",
            email: null,
            phone_e164: null,
            is_lead: false,
            ticket_type_id: "tt-1",
            checked_in_at: null,
            created_at: "2026-08-01T00:00:00Z",
            slot_status: "issued",
            cancellation_status: null,
          },
        ],
        event_ticket_types: [{ id: "tt-1", event_id: EVENT, title: "Dinner", sort_order: 0 }],
      })
    );

    const { parties, arrivals, notArrived } = await buildDoorRoster(EVENT);

    expect(parties).toHaveLength(0);
    expect(arrivals.some((a) => a.name === "Priya Guest")).toBe(false);
    expect(notArrived.some((r) => r.name === "Priya Guest")).toBe(false);
  });
});

describe("buildNewGuestListGroups", () => {
  it("groups a guest-list guest under their list name, independent of any registration", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_guest_lists: [
          {
            id: "list-1",
            event_id: EVENT,
            list_name: "Acme Sponsors",
            contact_name: "Jordan Contact",
            contact_email: "jordan@acme.test",
            contact_phone: null,
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        tickets: [
          {
            id: "ticket-guest-1",
            guest_list_id: "list-1",
            registration_id: null,
            name: "Priya Guest",
            email: null,
            phone_e164: null,
            ticket_type_id: "tt-1",
            checked_in_at: null,
            released_at: null,
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        event_ticket_types: [{ id: "tt-1", event_id: EVENT, title: "Dinner" }],
      })
    );

    const groups = await buildNewGuestListGroups(EVENT);

    expect(groups).toEqual([
      {
        id: "list-1",
        name: "Acme Sponsors",
        contactName: "Jordan Contact",
        slots: [
          {
            attendeeId: "ticket-guest-1",
            name: "Priya Guest",
            email: "",
            phone: "",
            ticketTypeId: "tt-1",
            ticketTypeTitle: "Dinner",
            isLead: false,
            checkedIn: false,
            arrivedAt: null,
          },
        ],
      },
    ]);
  });

  it("marks a checked-in guest-list guest as checked in with an arrival time", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_guest_lists: [
          {
            id: "list-1",
            event_id: EVENT,
            list_name: "Acme Sponsors",
            contact_name: "Jordan Contact",
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        tickets: [
          {
            id: "ticket-guest-1",
            guest_list_id: "list-1",
            name: "Priya Guest",
            ticket_type_id: "tt-1",
            checked_in_at: "2026-08-15T18:00:00Z",
            released_at: null,
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        event_ticket_types: [{ id: "tt-1", event_id: EVENT, title: "Dinner" }],
      })
    );

    const [group] = await buildNewGuestListGroups(EVENT);
    expect(group.slots[0]).toMatchObject({ checkedIn: true, arrivedAt: "2026-08-15T18:00:00Z" });
  });

  it("excludes a released (freed) guest-list ticket", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({
        event_guest_lists: [
          { id: "list-1", event_id: EVENT, list_name: "Acme Sponsors", contact_name: "Jordan", created_at: "2026-08-01T00:00:00Z" },
        ],
        tickets: [
          {
            id: "ticket-released",
            guest_list_id: "list-1",
            name: "Gone Guest",
            ticket_type_id: "tt-1",
            checked_in_at: null,
            released_at: "2026-08-10T00:00:00Z",
            created_at: "2026-08-01T00:00:00Z",
          },
        ],
        event_ticket_types: [{ id: "tt-1", event_id: EVENT, title: "Dinner" }],
      })
    );

    const [group] = await buildNewGuestListGroups(EVENT);
    expect(group.slots).toHaveLength(0);
  });

  it("returns an empty array for an event with no guest lists", async () => {
    mockedCreateAdminClient.mockReturnValue(
      rosterClient({ event_guest_lists: [], tickets: [], event_ticket_types: [] })
    );
    expect(await buildNewGuestListGroups(EVENT)).toEqual([]);
  });
});
