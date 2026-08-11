import { describe, it, expect } from "vitest";
import { buildDoorRoster, rosterTypeTotals } from "@/lib/events/door-roster";

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
