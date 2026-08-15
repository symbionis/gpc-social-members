import { describe, it, expect } from "vitest";
import { buildDoorRoster, rosterTypeTotals, rosterGuestListGroups } from "@/lib/events/door-roster";

type Row = Record<string, unknown>;

const EVENT = "evt-1";

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a ?? 0) - Number(b ?? 0);
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/**
 * Chainable stub that actually applies the filters the query passes, so a fixture can carry
 * rows the real query is meant to exclude (another event, a released ticket) and the test
 * proves the query rather than the projection. Mirrors door-access.test.ts.
 */
function rosterClient(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      let rows = (tables[table] ?? []).slice();
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
        rows = rows.slice(from, to + 1);
        return c;
      };
      c.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      c.single = async () => ({ data: rows[0] ?? null, error: null });
      (c as { then: unknown }).then = (
        resolve: (r: { data: unknown; error: unknown }) => unknown
      ) => resolve({ data: rows, error: null });
      return c;
    },
  } as never;
}

function ticket(over: Row): Row {
  return {
    id: "tk",
    event_id: EVENT,
    registration_id: "reg-paid",
    guest_list_id: null,
    member_id: null,
    name: "Someone Named",
    email: "someone@example.com",
    phone_e164: null,
    is_lead: false,
    slot_status: "claimed",
    ticket_type_id: "tt-dinner",
    cancellation_status: null,
    released_at: null,
    waiver_accepted_at: null,
    checked_in_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/**
 * A booking of 2 where one seat was cancelled, plus a booking of 1 refunded outright.
 * The sheet is a fallback door document: it must list who can actually be admitted, and
 * a cancelled seat is rejected at the scan, so it must not appear as a tickable line.
 */
function fixture() {
  return {
    events: [{ id: EVENT, title: "Test Event", start_date: "2026-01-10" }],
    event_ticket_types: [
      { id: "tt-dinner", event_id: EVENT, title: "Dinner", archived_at: null },
    ],
    event_registrations: [
      {
        id: "reg-paid",
        event_id: EVENT,
        reference_code: "GPC-0001",
        name: "Yannick Favre",
        email: "yannick@example.com",
        phone_e164: null,
        member_id: null,
        quantity: 2,
        status: "paid",
      },
      {
        id: "reg-refunded",
        event_id: EVENT,
        reference_code: "GPC-0002",
        name: "Nadia Hoffmann",
        email: "nadia@example.com",
        phone_e164: null,
        member_id: null,
        quantity: 1,
        status: "paid",
      },
    ],
    event_registration_items: [
      { registration_id: "reg-paid", ticket_type_id: "tt-dinner", title_snapshot: "Dinner", quantity: 2 },
      { registration_id: "reg-refunded", ticket_type_id: "tt-dinner", title_snapshot: "Dinner", quantity: 1 },
    ],
    tickets: [
      ticket({ id: "tk-lead", is_lead: true, name: "Yannick Favre" }),
      // The cancelled second seat of the same booking.
      ticket({ id: "tk-cancelled", name: "Chloe Favre", cancellation_status: "refunded" }),
      // A booking refunded in full — no live ticket left at all.
      ticket({
        id: "tk-refunded",
        registration_id: "reg-refunded",
        is_lead: true,
        name: "Nadia Hoffmann",
        cancellation_status: "refunded",
      }),
    ],
    members: [],
  };
}

async function build(tables: Record<string, Row[]>) {
  const result = await buildDoorRoster(rosterClient(tables), EVENT);
  if (result.status !== "ok") throw new Error(`unexpected status ${result.status}`);
  return result;
}

describe("buildDoorRoster — cancelled seats", () => {
  // The regression: the tickets query already excluded cancelled rows, but the party loop
  // then padded each booking back up to registration.quantity — putting the cancelled seat
  // straight back as a blank "to fill in" line.
  it("does not pad a cancelled seat back onto the sheet", async () => {
    const { rows } = await build(fixture());

    expect(rows).toHaveLength(1);
    expect(rows[0].first).toBe("Yannick");
    expect(rows.some((r) => r.first === "Chloe" || r.last === "Favre" && !r.named)).toBe(false);
    // No anonymous tickable line left behind by the cancelled seat.
    expect(rows.filter((r) => !r.named)).toHaveLength(0);
  });

  // A fully refunded booking has no live ticket, which used to trigger the
  // reconstruct-the-lead-from-the-purchaser path — printing a refunded party as arrivable.
  it("omits a fully refunded booking entirely", async () => {
    const { rows } = await build(fixture());

    expect(rows.some((r) => r.last === "Hoffmann")).toBe(false);
    expect(rows.some((r) => r.bookingRef === "GPC-0002")).toBe(false);
  });

  it("reports the party size net of cancellations", async () => {
    const { rows } = await build(fixture());
    // Bought 2, one cancelled — the lead line must not still claim 2 are coming.
    expect(rows[0].tickets).toBe("1");
  });

  it("counts only admissible tickets in the type totals", async () => {
    const { rows } = await build(fixture());
    expect(rosterTypeTotals(rows)).toEqual([{ title: "Dinner", qty: 1 }]);
  });

  // The early-bail only covered a FULLY cancelled party. When the lead cancels and a guest
  // is still coming, the lead's row is partitioned out, so the reconstruct-from-purchaser
  // branch rebuilt the refunded person as a named, tickable, isLead line — two lines for one
  // remaining seat, one of them someone who had been refunded.
  it("does not rebuild a cancelled lead from the purchaser when a guest is still coming", async () => {
    const tables = fixture();
    tables.tickets = [
      ticket({ id: "tk-lead", is_lead: true, name: "Yannick Favre", cancellation_status: "refunded" }),
      ticket({ id: "tk-guest", name: "Chloe Favre", email: "chloe@example.com" }),
    ];
    const { rows } = await build(tables);

    expect(rows.some((r) => r.first === "Yannick")).toBe(false);
    expect(rows.filter((r) => r.bookingRef === "GPC-0001")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ first: "Chloe", named: true });
    // The party size still has to be visible somewhere once the lead line is gone.
    expect(rows[0].tickets).toBe("1");
  });

  // The reconstruct branch must still fire for its real case: a legacy party that never had
  // ticket rows at all. Cancelling is not the same as never minting.
  it("still rebuilds a lead that was never minted", async () => {
    const tables = fixture();
    tables.tickets = [];
    tables.event_registrations = tables.event_registrations.filter((r) => r.id === "reg-paid");
    const { rows } = await build(tables);

    expect(rows.some((r) => r.first === "Yannick" && r.isLead)).toBe(true);
  });

  // The padding itself is legitimate: a booking whose ticket rows were never minted still
  // has to print its seats, or staff arrive with a short sheet.
  it("still pads a booking whose tickets were never minted", async () => {
    const tables = fixture();
    // Just the 2-seat booking, with only its lead ticket minted — nothing cancelled.
    tables.tickets = [tables.tickets[0]];
    tables.event_registrations = tables.event_registrations.filter((r) => r.id === "reg-paid");
    const { rows } = await build(tables);

    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => !r.named)).toHaveLength(1);
    expect(rows[0].tickets).toBe("2");
  });
});

/**
 * U6 — guest-list guests on the door roster.
 *
 * A guest-list ticket (U5) is minted with `registration_id: null` and `guest_list_id` set,
 * `slot_status: 'issued'`, and a real name already on it (lib/events/guest-lists.ts's
 * addGuestToList). It never goes through the self-registration claim flow, so it stays
 * 'issued' through check-in (lib/events/checkin.ts only ever sets `checked_in_at`).
 *
 * `tickets.registration_id` has never been null in production before U5 — every read
 * touching `tickets` has only ever run against rows that have a registration. The plan's
 * own Risks section calls this the single highest-risk consequence of the whole plan: an
 * inner join through registrations would silently drop these rows rather than error.
 */
describe("buildDoorRoster — guest-list guests (U6)", () => {
  function guestListFixture() {
    return {
      events: [{ id: EVENT, title: "Test Event", start_date: "2026-01-10" }],
      event_ticket_types: [
        { id: "tt-dinner", event_id: EVENT, title: "Dinner", archived_at: null },
      ],
      event_registrations: [
        {
          id: "reg-paid",
          event_id: EVENT,
          reference_code: "GPC-0001",
          name: "Yannick Favre",
          email: "yannick@example.com",
          phone_e164: null,
          member_id: null,
          quantity: 1,
          status: "paid",
        },
      ],
      event_registration_items: [
        { registration_id: "reg-paid", ticket_type_id: "tt-dinner", title_snapshot: "Dinner", quantity: 1 },
      ],
      event_guest_lists: [
        {
          id: "gl-cardis",
          event_id: EVENT,
          list_name: "Cardis Sponsor",
          contact_name: "Jane Doe",
          contact_email: "jane@cardis.example",
          contact_phone: null,
        },
      ],
      tickets: [
        ticket({ id: "tk-lead", is_lead: true, name: "Yannick Favre" }),
        // A guest-list ticket: no registration, a name already on it, never claimed.
        ticket({
          id: "tk-guest-list",
          registration_id: null,
          guest_list_id: "gl-cardis",
          is_lead: false,
          slot_status: "issued",
          name: "Ana Vidal",
          email: null,
        }),
      ],
      members: [],
    };
  }

  // The plan's own risk item, made explicit: prove the registration-less ticket is
  // actually returned, not silently dropped by a join through registrations.
  it("does not drop a registration-less guest-list ticket", async () => {
    const { rows } = await build(guestListFixture());
    expect(rows.some((r) => r.first === "Ana" && r.last === "Vidal")).toBe(true);
  });

  it("carries guest_list_id and the list name onto the roster row", async () => {
    const { rows } = await build(guestListFixture());
    const row = rows.find((r) => r.last === "Vidal");
    expect(row).toMatchObject({
      guestListId: "gl-cardis",
      guestListName: "Cardis Sponsor",
      guestListContact: "Jane Doe",
    });
  });

  // The real bug this unit had to catch: an 'issued' guest-list ticket is NOT an unclaimed
  // placeholder — it already has a name. Reading "named" as isClaimed alone would print
  // this guest as an anonymous "to fill in" blank line, discarding the name the sponsor gave.
  it("prints a guest-list guest's real name rather than a blank 'to fill in' line", async () => {
    const { rows } = await build(guestListFixture());
    const row = rows.find((r) => r.guestListId === "gl-cardis");
    expect(row?.named).toBe(true);
    expect(row).toMatchObject({ first: "Ana", last: "Vidal" });
  });

  it("still shows the guest-list guest as named after check-in, though slot_status stays 'issued'", async () => {
    const tables = guestListFixture();
    tables.tickets[1] = { ...tables.tickets[1], checked_in_at: "2026-01-10T18:00:00Z" };
    const { rows } = await build(tables);
    const row = rows.find((r) => r.guestListId === "gl-cardis");
    expect(row?.named).toBe(true);
    expect(row?.arrived).toBe("yes");
  });

  it("appears in the ticket-type totals like any other ticket", async () => {
    const { rows } = await build(guestListFixture());
    // Both the purchased lead and the guest-list guest hold a Dinner ticket.
    expect(rosterTypeTotals(rows)).toContainEqual({ title: "Dinner", qty: 2 });
  });

  // Scenario 4: a ticketed (non-guest-list) scan is unaffected by the presence of guest
  // lists — the ordinary party's own row is untouched by any of the above.
  it("leaves an ordinary ticketed party unaffected by the presence of a guest list", async () => {
    const { rows } = await build(guestListFixture());
    const lead = rows.find((r) => r.first === "Yannick");
    expect(lead).toMatchObject({
      named: true,
      isLead: true,
      guestListId: null,
      guestListName: "",
    });
  });

  it("groups guest-list rows under their list via rosterGuestListGroups", async () => {
    const { rows } = await build(guestListFixture());
    const groups = rosterGuestListGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "gl-cardis", name: "Cardis Sponsor", contactName: "Jane Doe" });
    expect(groups[0].rows.map((r) => r.last)).toEqual(["Vidal"]);
  });

  // Regression guard: an event with no guest lists renders exactly as before — no
  // event_guest_lists query fires (guestListIds is empty), and every row's guest-list
  // fields are the null/blank defaults.
  it("renders exactly as before on an event with no guest lists", async () => {
    const { rows } = await build(fixture());
    expect(rosterGuestListGroups(rows)).toHaveLength(0);
    expect(rows.every((r) => r.guestListId === null)).toBe(true);
  });

  // Verification: a door session admits one purchased attendee and one guest-list guest
  // through the same control (the ordinary check-in route sets checked_in_at on any live
  // ticket id, U5/KD10 — this unit adds no check-in branch), and both surface in arrivals.
  it("admits a purchased attendee and a guest-list guest through the same control, both in arrivals", async () => {
    const tables = guestListFixture();
    // Simulate both having been checked in through the ordinary flow: checked_in_at set,
    // nothing else about the row's shape changed.
    tables.tickets[0] = { ...tables.tickets[0], checked_in_at: "2026-01-10T18:00:00Z" };
    tables.tickets[1] = { ...tables.tickets[1], checked_in_at: "2026-01-10T18:05:00Z" };
    const { rows } = await build(tables);

    const arrived = rows.filter((r) => r.arrived === "yes");
    expect(arrived.map((r) => `${r.first} ${r.last}`).sort()).toEqual(["Ana Vidal", "Yannick Favre"]);
  });
});
