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
        c.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
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
        ) => resolve({ data: rows, error: null });
        return c;
      }
      if (table === "event_waitlist") {
        c.insert = async (payload: Row) => {
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

const VALID = { name: "Sophie Lambert", email: "sophie@example.com", quantity: 2 };

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
    expect(cfg.captured).toMatchObject({ ticket_type_id: "tt-dinner", quantity: 2 });
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
