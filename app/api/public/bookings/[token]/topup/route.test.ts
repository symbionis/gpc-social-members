import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/events/roster", () => ({
  mintRegistrationTickets: vi.fn(),
  applyPendingRoster: vi.fn(),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/topup/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { applyPendingRoster } from "@/lib/events/roster";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const mockedSeats = vi.mocked(getSeatsUsed);
const mockedApplyRoster = vi.mocked(applyPendingRoster);

/** The pending_roster payload the route stashed before checkout, if any. */
let lastRosterWrite: unknown = null;

const TYPE = "33333333-3333-3333-3333-333333333333";

// reg → booking; events → seat_cap; event_ticket_types → priced type; topups insert →
// {id}; rpc → applied.
function adminClient(opts: {
  reg?: Record<string, unknown> | null;
  price?: number | null;
  seatCap?: number | null;
  countsAsSeat?: boolean;
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.limit = () => c;
      c.insert = () => c;
      c.update = (payload: Record<string, unknown>) => {
        if (table === "event_registrations" && "pending_roster" in payload) {
          lastRosterWrite = payload.pending_roster;
        }
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_registrations")
          return {
            data:
              "reg" in opts
                ? opts.reg
                : { id: "reg", event_id: "evt", is_member: true, status: "paid", email: "l@x.com" },
            error: null,
          };
        if (table === "events") return { data: { seat_cap: opts.seatCap ?? null }, error: null };
        if (table === "event_registration_topups") return { data: { id: "topup-1" }, error: null };
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_ticket_types")
          return resolve({
            data: [{ id: TYPE, title: "Adult", price_member: opts.price ?? 25, price_non_member: 40, archived_at: null, counts_as_seat: opts.countsAsSeat ?? false }],
            error: null,
          });
        return resolve({ data: [], error: null });
      };
      return c;
    },
    rpc: async () => ({ data: { status: "applied", added: 1 }, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

/** n distinct, fully-named guests of the test ticket type. */
function guests(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ticket_type_id: TYPE,
    name: `Guest Number${i + 1}`,
    email: `guest${i + 1}@x.com`,
  }));
}

function post(body: unknown, token = "mtok") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/topup`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastRosterWrite = null;
  mockedAdmin.mockReturnValue(adminClient({}));
  mockedSeats.mockResolvedValue(0);
  mockedStripe.mockReturnValue({
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" }) } },
  } as never);
});

describe("POST /api/public/bookings/[token]/topup", () => {
  it("requires at least one item", async () => {
    const res = await post({ items: [] });
    expect(res.status).toBe(400);
  });

  it("404s an unknown booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: null }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }] });
    expect(res.status).toBe(404);
  });

  it("creates a Stripe checkout for a paid top-up", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: guests(2) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkoutUrl: "https://stripe.test/cs" });
  });

  it("409s when the buy-more would exceed the event seat cap", async () => {
    // seat_cap 10, already 9 used; a seat-consuming top-up of 2 → 11 > 10.
    mockedAdmin.mockReturnValue(adminClient({ seatCap: 10, countsAsSeat: true }));
    mockedSeats.mockResolvedValue(9);
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }] });
    expect(res.status).toBe(409);
  });

  it("allows a seat-consuming top-up that fits under the cap", async () => {
    mockedAdmin.mockReturnValue(adminClient({ seatCap: 10, countsAsSeat: true }));
    mockedSeats.mockResolvedValue(5);
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: guests(2) });
    expect(res.status).toBe(200);
  });

  it("applies a free top-up immediately without checkout", async () => {
    mockedAdmin.mockReturnValue(adminClient({ price: 0 }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }] , attendees: guests(2) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
  });
});

describe("mandatory naming on top-ups", () => {
  it("refuses a top-up that names nobody", async () => {
    // The gap this closes: a top-up used to mint seats with no name and no contact, long
    // after the public checkout stopped allowing one.
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/needs a name and email/);
  });

  it("refuses when fewer guests are named than seats bought", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: guests(1) });
    expect(res.status).toBe(400);
  });

  it("refuses a guest with no surname", async () => {
    const res = await post({
      items: [{ ticketTypeId: TYPE, quantity: 1 }],
      attendees: [{ ticket_type_id: TYPE, name: "Madonna", email: "m@x.com" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/first and last name/);
  });

  it("refuses a guest with no valid email", async () => {
    const res = await post({
      items: [{ ticketTypeId: TYPE, quantity: 1 }],
      attendees: [{ ticket_type_id: TYPE, name: "Ana Vidal", email: "not-an-email" }],
    });
    expect(res.status).toBe(400);
  });

  it("refuses the same person named twice", async () => {
    // Two identical identities collapse into one ticket at claim time, leaving the sibling
    // seat unnamed — the exact bypass the checkout already rejects.
    const dup = { ticket_type_id: TYPE, name: "Ana Vidal", email: "ana@x.com" };
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: [dup, dup] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/same name and email/);
  });

  it("stashes the names before sending the buyer to Stripe", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: guests(2) });
    expect(res.status).toBe(200);
    // Stashed BEFORE payment: a paid top-up whose roster never persisted would mint exactly
    // the unnamed seats this change exists to prevent.
    expect(lastRosterWrite).toEqual([
      { ticket_type_id: TYPE, name: "Guest Number1", email: "guest1@x.com" },
      { ticket_type_id: TYPE, name: "Guest Number2", email: "guest2@x.com" },
    ]);
  });

  it("names the seats immediately on a free top-up, which has no webhook", async () => {
    mockedAdmin.mockReturnValue(adminClient({ price: 0 }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }], attendees: guests(1) });
    expect(res.status).toBe(200);
    expect(mockedApplyRoster).toHaveBeenCalledWith("reg");
  });
});
