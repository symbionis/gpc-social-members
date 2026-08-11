import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/events/seat-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/seat-usage")>();
  return { ...actual, getSeatsUsed: vi.fn() };
});

import { POST } from "@/app/api/events/[id]/waitlist/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSession = vi.mocked(createClient);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

const EVENT_ID = "evt-1";

type Row = Record<string, unknown>;

type Cfg = {
  ticketTypes: Row[];
  /** Live registrations for the event, matched on email by the already-registered guard. */
  registrations?: Row[];
  /** Existing waitlist rows, matched on email by the one-entry-per-person guard. */
  waitlistEntries?: Row[];
  /** Force a query error, so the fail-closed branches are reachable from a test at all. */
  ticketTypeError?: boolean;
  registrationsError?: boolean;
  waitlistLookupError?: boolean;
  /** Simulate the unique index catching a concurrent duplicate the pre-check raced past. */
  insertDuplicate?: boolean;
  captured?: Row;
};

/**
 * Applies the filters the route passes, so a fixture can carry a ticket type the query is
 * meant to reject — archived, or non-seat — and the test proves the QUERY rather than the
 * projection. Dropping a filter must fail a test, not pass silently.
 */
function adminClient(cfg: Cfg) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      if (table === "events") {
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.single = async () => ({
          data: {
            id: EVENT_ID,
            is_published: true,
            registration_enabled: true,
            visibility: "public",
            seat_cap: 10,
          },
          error: null,
        });
        return c;
      }
      if (table === "event_ticket_types") {
        let rows = cfg.ticketTypes.slice();
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return c;
        };
        c.is = (col: string, val: unknown) => {
          rows = rows.filter((r) => (r[col] ?? null) === val);
          return c;
        };
        c.maybeSingle = async () =>
          cfg.ticketTypeError
            ? { data: null, error: { message: "ticket type lookup failed" } }
            : { data: rows[0] ?? null, error: null };
        return c;
      }
      if (table === "event_registrations") {
        let rows = (cfg.registrations ?? []).slice();
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return c;
        };
        c.in = (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col] as never));
          return c;
        };
        c.limit = () => c;
        (c as { then: unknown }).then = (
          resolve: (r: { data: unknown; error: unknown }) => unknown
        ) =>
          resolve(
            cfg.registrationsError
              ? { data: null, error: { message: "registration lookup failed" } }
              : { data: rows, error: null }
          );
        return c;
      }
      if (table === "event_waitlist") {
        let rows = (cfg.waitlistEntries ?? []).slice();
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return c;
        };
        c.limit = () => c;
        (c as { then: unknown }).then = (
          resolve: (r: { data: unknown; error: unknown }) => unknown
        ) =>
          resolve(
            cfg.waitlistLookupError
              ? { data: null, error: { message: "waitlist lookup failed" } }
              : { data: rows, error: null }
          );
        c.insert = async (payload: Row) => {
          if (cfg.insertDuplicate) return { error: { code: "23505", message: "duplicate key" } };
          cfg.captured = payload;
          return { error: null };
        };
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function post(body: unknown) {
  const req = {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
  return POST(req, { params: Promise.resolve({ id: EVENT_ID }) });
}

const seatType: Row = {
  id: "tt-dinner",
  event_id: EVENT_ID,
  archived_at: null,
  counts_as_seat: true,
};
const merchType: Row = {
  id: "tt-merch",
  event_id: EVENT_ID,
  archived_at: null,
  counts_as_seat: false,
};
const archivedType: Row = {
  id: "tt-old",
  event_id: EVENT_ID,
  archived_at: "2026-01-01T00:00:00Z",
  counts_as_seat: true,
};

// No quantity: the waitlist is one ticket per person, so the field is absent in practice.
const VALID = { name: "Sophie Lambert", email: "sophie@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedSeatsUsed.mockResolvedValue(10); // full, so the waitlist is open
  mockedSession.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never);
});

describe("POST /api/events/[id]/waitlist — ticket type", () => {
  it("accepts a live seat-consuming type", async () => {
    const cfg: Cfg = { ticketTypes: [seatType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(200);
    expect(cfg.captured).toMatchObject({ ticket_type_id: "tt-dinner", quantity: 1 });
  });

  // The waitlist exists to queue people for a SEAT. A type that consumes none can never be
  // offered one (deriveWaitlistOfferability rejects it), so accepting the signup would queue
  // someone behind a seat that is never freed for them and leave an entry an admin can only
  // repair or delete.
  it("rejects a type that does not consume a seat", async () => {
    const cfg: Cfg = { ticketTypes: [merchType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-merch" });

    expect(res.status).toBe(400);
    expect(cfg.captured).toBeUndefined();
  });

  it("rejects an archived type", async () => {
    const cfg: Cfg = { ticketTypes: [archivedType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-old" });

    expect(res.status).toBe(400);
    expect(cfg.captured).toBeUndefined();
  });

  it("rejects a type belonging to another event", async () => {
    const cfg: Cfg = { ticketTypes: [{ ...seatType, event_id: "evt-OTHER" }] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(cfg.captured).toBeUndefined();
  });
});

describe("POST /api/events/[id]/waitlist — quantity", () => {
  // These are the states that would otherwise reach the admin waitlist as an unofferable
  // row. They are rejected at the door rather than repaired later.
  it.each([0, -1, 11, 2.5])("rejects quantity %s", async (quantity) => {
    const cfg: Cfg = { ticketTypes: [seatType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, quantity, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(cfg.captured).toBeUndefined();
  });

  it("rejects a missing ticket type", async () => {
    const cfg: Cfg = { ticketTypes: [seatType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID });

    expect(res.status).toBe(400);
    expect(cfg.captured).toBeUndefined();
  });
});

describe("POST /api/events/[id]/waitlist — already registered", () => {
  // The state that used to reach the admin waitlist as an unofferable row nobody could
  // repair: the register route's duplicate-email guard would reject the redemption anyway.
  it("rejects someone who already holds a seat", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      registrations: [
        { id: "reg-1", event_id: EVENT_ID, email: "sophie@example.com", status: "paid" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "You already have a registration for this event",
    });
    expect(cfg.captured).toBeUndefined();
  });

  it("ignores a registration for a different event", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      registrations: [
        { id: "reg-1", event_id: "evt-OTHER", email: "sophie@example.com", status: "paid" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });
    expect(res.status).toBe(200);
  });

  // A pending checkout is not a seat — it may never be paid, so it must not block the queue.
  it("ignores a pending registration", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      registrations: [
        { id: "reg-1", event_id: EVENT_ID, email: "sophie@example.com", status: "pending" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/[id]/waitlist — one ticket per person", () => {
  // A request for several seats carries no name or email for the extra people, so redeeming
  // it would mint unnamed tickets — the thing every other purchase path was changed to stop.
  it("stores a quantity of 1 when none is sent", async () => {
    const cfg: Cfg = { ticketTypes: [seatType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({
      name: VALID.name,
      email: VALID.email,
      ticket_type_id: "tt-dinner",
    });

    expect(res.status).toBe(200);
    expect(cfg.captured).toMatchObject({ quantity: 1 });
  });

  // A stale cached form is refused rather than silently reduced to 1 — the person asked for
  // two seats and should be told they cannot have them, not quietly given one.
  it.each([2, 5, 10])("refuses a request for %s tickets", async (quantity) => {
    const cfg: Cfg = { ticketTypes: [seatType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, quantity, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "The waitlist is one ticket per person — please refresh and try again.",
    });
    expect(cfg.captured).toBeUndefined();
  });
});

describe("POST /api/events/[id]/waitlist — one entry per email", () => {
  it("rejects a second signup with the same email", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      waitlistEntries: [
        { id: "wl-1", event_id: EVENT_ID, email: "sophie@example.com" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "You are already on the waitlist for this event",
    });
    expect(cfg.captured).toBeUndefined();
  });

  it("allows the same email on a different event", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      waitlistEntries: [
        { id: "wl-1", event_id: "evt-OTHER", email: "sophie@example.com" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });
    expect(res.status).toBe(200);
  });

  it("matches the email case-insensitively, as it is stored", async () => {
    const cfg: Cfg = {
      ticketTypes: [seatType],
      waitlistEntries: [
        { id: "wl-1", event_id: EVENT_ID, email: "sophie@example.com" },
      ],
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({
      ...VALID,
      email: "  SOPHIE@Example.com ",
      ticket_type_id: "tt-dinner",
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Each guard below fails CLOSED: on a query error the signup is refused rather than accepted,
 * because proceeding would create exactly the entry the guard exists to prevent and nothing
 * downstream could tell it apart from an ordinary signup. Without these tests all three
 * branches were deletable with the suite green.
 */
describe("POST /api/events/[id]/waitlist — fails closed on query errors", () => {
  it("refuses when the ticket-type lookup fails, and does not blame the ticket type", async () => {
    const cfg: Cfg = { ticketTypes: [seatType], ticketTypeError: true };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(500);
    // Telling someone their type is unavailable when the lookup merely failed sends them to
    // refresh, see it still offered, and give up.
    expect(await res.json()).toMatchObject({ error: "Could not verify availability" });
    expect(cfg.captured).toBeUndefined();
  });

  it("refuses when the already-registered lookup fails", async () => {
    const cfg: Cfg = { ticketTypes: [seatType], registrationsError: true };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(500);
    expect(cfg.captured).toBeUndefined();
  });

  it("refuses when the duplicate-entry lookup fails", async () => {
    const cfg: Cfg = { ticketTypes: [seatType], waitlistLookupError: true };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(500);
    expect(cfg.captured).toBeUndefined();
  });

  // The race the unique index exists to catch: two submissions in flight, both past the
  // pre-check. The index rejects the second, and the user must see the readable message
  // rather than a generic failure.
  it("turns a concurrent duplicate into the same readable message", async () => {
    const cfg: Cfg = { ticketTypes: [seatType], insertDuplicate: true };
    mockedAdmin.mockReturnValue(adminClient(cfg));

    const res = await post({ ...VALID, ticket_type_id: "tt-dinner" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "You are already on the waitlist for this event",
    });
  });
});
