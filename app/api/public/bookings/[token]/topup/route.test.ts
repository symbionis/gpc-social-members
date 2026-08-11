import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/events/roster", () => ({
  mintRegistrationTickets: vi.fn(),
  applyTopupRoster: vi.fn().mockResolvedValue("applied"),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/topup/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { applyTopupRoster } from "@/lib/events/roster";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const mockedSeats = vi.mocked(getSeatsUsed);
const mockedApplyRoster = vi.mocked(applyTopupRoster);

/** The pending_roster payload the route stashed on the TOP-UP row before checkout, if any. */
let lastRosterWrite: unknown = null;
/** Any write to the registration's shared pending_roster slot — should stay null. */
let registrationRosterWrite: unknown = null;
/** The Stripe checkout session mock, so tests can assert what metadata went on the wire. */
let sessionCreate: ReturnType<typeof vi.fn>;

const TYPE = "33333333-3333-3333-3333-333333333333";

// reg → booking; events → seat_cap; event_ticket_types → priced type; topups insert →
// {id}; rpc → applied.
function adminClient(opts: {
  reg?: Record<string, unknown> | null;
  price?: number | null;
  seatCap?: number | null;
  countsAsSeat?: boolean;
  /** Seats already named on the booking, as claim_ticket's dedupe would see them. */
  claimed?: { name: string | null; email: string | null }[];
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.is = () => c;
      c.limit = () => c;
      // The names ride on the top-up row itself, not on the registration's shared slot —
      // that is what stops a redelivery of the original checkout from consuming them.
      c.insert = (payload: Record<string, unknown>) => {
        if (table === "event_registration_topups" && "pending_roster" in payload) {
          lastRosterWrite = payload.pending_roster;
        }
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        if (table === "event_registrations" && "pending_roster" in payload) {
          registrationRosterWrite = payload.pending_roster;
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
        // Seats already named on this booking — what claim_ticket would dedupe against.
        if (table === "tickets") return resolve({ data: opts.claimed ?? [], error: null });
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
  registrationRosterWrite = null;
  mockedAdmin.mockReturnValue(adminClient({}));
  mockedSeats.mockResolvedValue(0);
  sessionCreate = vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" });
  mockedStripe.mockReturnValue({
    checkout: { sessions: { create: sessionCreate } },
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

  // parseAttendeeInput only sees ONE order. claim_ticket dedupes against every seat already
  // named on the booking — so a lead topping up under their own name and email got
  // `already: true`, no seat claimed, and a charge for a permanently unnamed ticket. A
  // top-up is the only purchase path where prior claimed seats exist.
  it("refuses a guest who already holds a seat on this booking", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ claimed: [{ name: "Ana Vidal", email: "ana@x.com" }] })
    );
    const res = await post({
      items: [{ ticketTypeId: TYPE, quantity: 1 }],
      attendees: [{ ticket_type_id: TYPE, name: "Ana Vidal", email: "ana@x.com" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already has a ticket on this booking/i);
  });

  it("matches the existing seat the way claim_ticket does — case and spacing folded", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ claimed: [{ name: "Ana  Vidal", email: "Ana@X.com" }] })
    );
    const res = await post({
      items: [{ ticketTypeId: TYPE, quantity: 1 }],
      attendees: [{ ticket_type_id: TYPE, name: "ana vidal", email: "ana@x.com" }],
    });
    expect(res.status).toBe(400);
  });

  // A shared address is legitimate (households book on one email) — only the same PERSON
  // twice is refused.
  it("allows a different guest on an email already used by another seat", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ claimed: [{ name: "Ana Vidal", email: "shared@x.com" }] })
    );
    const res = await post({
      items: [{ ticketTypeId: TYPE, quantity: 1 }],
      attendees: [{ ticket_type_id: TYPE, name: "Ben Torres", email: "shared@x.com" }],
    });
    expect(res.status).toBe(200);
  });

  it("refuses the same person named twice", async () => {
    // Two identical identities collapse into one ticket at claim time, leaving the sibling
    // seat unnamed — the exact bypass the checkout already rejects.
    const dup = { ticket_type_id: TYPE, name: "Ana Vidal", email: "ana@x.com" };
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: [dup, dup] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/same name and email/);
  });

  it("stashes the names on the top-up row before sending the buyer to Stripe", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }], attendees: guests(2) });
    expect(res.status).toBe(200);
    // Stashed BEFORE payment: a paid top-up whose roster never persisted would mint exactly
    // the unnamed seats this change exists to prevent.
    expect(lastRosterWrite).toEqual([
      { ticket_type_id: TYPE, name: "Guest Number1", email: "guest1@x.com" },
      { ticket_type_id: TYPE, name: "Guest Number2", email: "guest2@x.com" },
    ]);
    // And NOT on the registration's shared slot. Writing there gave the column two
    // producers, so a redelivery of the booking's original checkout could consume this
    // top-up's names and leave its seats unnamed.
    expect(registrationRosterWrite).toBeNull();
  });

  it("names the seats immediately on a free top-up, which has no webhook", async () => {
    mockedAdmin.mockReturnValue(adminClient({ price: 0 }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }], attendees: guests(1) });
    expect(res.status).toBe(200);
    // Keyed on the top-up, not the registration: the free path names exactly the seats
    // this top-up bought.
    expect(mockedApplyRoster).toHaveBeenCalledWith("topup-1");
  });

  // The webhook gates SOLELY on topup_id presence now. If this key is ever dropped or
  // renamed here, every paid top-up captures money and mints nothing — and no other test
  // would notice, because both sides use a hardcoded id.
  it("puts topup_id on the checkout session so the webhook can find the branch", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }], attendees: guests(1) });
    expect(res.status).toBe(200);
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          topup_id: "topup-1",
          event_registration_id: "reg",
        }),
      })
    );
  });

  // No webhook on the free path means no retry: this is the only attempt these names get,
  // so the lead has to be told rather than shown a clean success.
  it("warns the lead when a free top-up's seats could not be named", async () => {
    mockedAdmin.mockReturnValue(adminClient({ price: 0 }));
    mockedApplyRoster.mockResolvedValue("error");
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }], attendees: guests(1) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      warning: expect.stringMatching(/couldn't attach the guest names/i),
    });
  });
});
