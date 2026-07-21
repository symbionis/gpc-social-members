import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/convert/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const mockedSeats = vi.mocked(getSeatsUsed);

const FROM = "11111111-1111-1111-1111-111111111111";
const TO = "22222222-2222-2222-2222-222222222222";
const TICKET = "33333333-3333-3333-3333-333333333333";

// reg → booking; tickets → the target ticket (from-type); event_ticket_types → [from, to];
// events → seat_cap; conversions insert → {id}; rpc → applied.
interface Opts {
  reg?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
  isMember?: boolean;
  status?: string;
  fromMember?: number | null;
  toMember?: number | null;
  toNon?: number | null;
  toInvite?: number | null;
  fromSeat?: boolean;
  toSeat?: boolean;
  toArchived?: string | null;
  seatCap?: number | null;
  rpcStatus?: string;
}

function adminClient(opts: Opts) {
  const fromType = {
    id: FROM, title: "Standard",
    price_member: opts.fromMember ?? 0, price_non_member: 0, invite_price: null,
    archived_at: null, counts_as_seat: opts.fromSeat ?? false,
  };
  const toType = {
    id: TO, title: "With food",
    price_member: opts.toMember === undefined ? 25 : opts.toMember,
    price_non_member: opts.toNon ?? 40, invite_price: opts.toInvite ?? null,
    archived_at: opts.toArchived ?? null, counts_as_seat: opts.toSeat ?? false,
  };
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.is = () => c;
      c.limit = () => c;
      c.insert = () => c;
      c.maybeSingle = async () => {
        if (table === "event_registrations")
          return {
            data:
              "reg" in opts
                ? opts.reg
                : { id: "reg", event_id: "evt", is_member: opts.isMember ?? true, status: opts.status ?? "paid", email: "l@x.com" },
            error: null,
          };
        if (table === "tickets")
          return {
            data:
              "ticket" in opts
                ? opts.ticket
                : { id: TICKET, ticket_type_id: FROM, slot_status: "issued", checked_in_at: null, released_at: null, batch_token: null },
            error: null,
          };
        if (table === "events") return { data: { seat_cap: opts.seatCap ?? null }, error: null };
        if (table === "event_ticket_type_conversions") return { data: { id: "conv-1" }, error: null };
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_ticket_types") return resolve({ data: [fromType, toType], error: null });
        return resolve({ data: [], error: null });
      };
      return c;
    },
    rpc: async () => ({ data: { status: opts.rpcStatus ?? "applied" }, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, token = "mtok") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/convert`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({}));
  mockedSeats.mockResolvedValue(0);
  mockedStripe.mockReturnValue({
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" }) } },
  } as never);
});

describe("POST /api/public/bookings/[token]/convert", () => {
  it("rejects a malformed body", async () => {
    const res = await post({ ticketId: "nope", toTicketTypeId: "nope" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: null }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(404);
  });

  it("409s a booking that isn’t confirmed", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "pending" }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(409);
  });

  it("409s an ineligible (e.g. checked-in / released) ticket", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: null }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(409);
  });

  it("creates a Stripe checkout for a paid upgrade (delta > 0)", async () => {
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkoutUrl: "https://stripe.test/cs" });
  });

  it("applies inline for a zero-delta upgrade (no checkout)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ toMember: 0 }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
  });

  it("rejects a downgrade (delta < 0)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ fromMember: 25, toMember: 0 }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(400);
  });

  it("500s when the target price is misconfigured (null)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ toMember: null }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(500);
  });

  it("uses the invite_price fallback for a non-member on a members-only type", async () => {
    // Non-member, price_non_member null → must fall back to invite_price (30) so the
    // food type is priceable rather than a 500.
    mockedAdmin.mockReturnValue(adminClient({ isMember: false, toMember: null, toNon: null, toInvite: 30 }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkoutUrl: expect.any(String) });
  });

  it("covers R9: allows conversion between any two types (former child/adult boundary removed)", async () => {
    // Formerly rejected (KTD6). The child/adult distinction is retired, so any
    // same-or-higher priced upgrade now proceeds.
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkoutUrl: expect.any(String) });
  });

  it("409s a seat-consuming conversion when the event is full", async () => {
    mockedAdmin.mockReturnValue(adminClient({ fromSeat: false, toSeat: true, seatCap: 10 }));
    mockedSeats.mockResolvedValue(10);
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(409);
  });

  it("skips the seat check for a seat-neutral conversion", async () => {
    // to also non-seat → no seat check even though the event is full.
    mockedAdmin.mockReturnValue(adminClient({ fromSeat: false, toSeat: false, seatCap: 10 }));
    mockedSeats.mockResolvedValue(10);
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO });
    expect(res.status).toBe(200);
  });

  it("rejects converting to the same type", async () => {
    const res = await post({ ticketId: TICKET, toTicketTypeId: FROM });
    expect(res.status).toBe(400);
  });
});

// U11: a household member upgrades from the manage page with a PER-TICKET manage_token.
// The path token resolves no registration, so the route falls to the ticket lookup, derives
// the registration, restricts the target to the caller's email household, and redirects to
// /public/tickets (not /public/bookings).
function holderAdmin(opts: {
  self?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
}) {
  const fromType = { id: FROM, title: "Standard", price_member: 0, price_non_member: 0, invite_price: null, archived_at: null, counts_as_seat: false };
  const toType = { id: TO, title: "With food", price_member: 25, price_non_member: 40, invite_price: null, archived_at: null, counts_as_seat: false };
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.is = () => c;
      c.in = () => c;
      c.limit = () => c;
      c.insert = () => c;
      c.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_registrations")
          return { data: "manage_token" in filters ? null : "reg" in opts ? opts.reg : { id: "reg", event_id: "evt", is_member: true, status: "paid", email: "l@x.com" }, error: null };
        if (table === "tickets")
          return {
            data:
              "manage_token" in filters
                ? "self" in opts
                  ? opts.self
                  : { registration_id: "reg", email: "house@x.com" }
                : "ticket" in opts
                  ? opts.ticket
                  : { id: TICKET, ticket_type_id: FROM, slot_status: "issued", checked_in_at: null, released_at: null, email: "house@x.com" },
            error: null,
          };
        if (table === "events") return { data: { seat_cap: null }, error: null };
        if (table === "event_ticket_type_conversions") return { data: { id: "conv-1" }, error: null };
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_ticket_types") return resolve({ data: [fromType, toType], error: null });
        return resolve({ data: [], error: null });
      };
      return c;
    },
    rpc: async () => ({ data: { status: "applied" }, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

describe("POST /api/public/bookings/[token]/convert (household member via per-ticket token)", () => {
  it("upgrades a same-email household ticket and redirects to /public/tickets", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" });
    mockedStripe.mockReturnValue({ checkout: { sessions: { create } } } as never);
    mockedAdmin.mockReturnValue(holderAdmin({}));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO }, "ptoken");
    expect(res.status).toBe(200);
    const args = create.mock.calls[0][0];
    expect(args.success_url).toContain("/public/tickets/ptoken");
    expect(args.cancel_url).toContain("/public/tickets/ptoken");
  });

  it("409s a ticket outside the caller's email household", async () => {
    mockedAdmin.mockReturnValue(
      holderAdmin({ ticket: { id: TICKET, ticket_type_id: FROM, slot_status: "issued", checked_in_at: null, released_at: null, email: "someone@else.com" } })
    );
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO }, "ptoken");
    expect(res.status).toBe(409);
  });

  it("404s an unknown per-ticket token", async () => {
    mockedAdmin.mockReturnValue(holderAdmin({ self: null, reg: null }));
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO }, "nope");
    expect(res.status).toBe(404);
  });

  it("409s a blank-email token acting on a DIFFERENT blank-email ticket (solo fallback)", async () => {
    mockedAdmin.mockReturnValue(
      holderAdmin({
        self: { id: "SELF", registration_id: "reg", email: "" },
        ticket: { id: TICKET, ticket_type_id: FROM, slot_status: "issued", checked_in_at: null, released_at: null, email: "" },
      })
    );
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO }, "ptoken");
    expect(res.status).toBe(409);
  });

  it("allows a blank-email token to act on its OWN ticket", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" });
    mockedStripe.mockReturnValue({ checkout: { sessions: { create } } } as never);
    mockedAdmin.mockReturnValue(
      holderAdmin({
        self: { id: TICKET, registration_id: "reg", email: "" },
        ticket: { id: TICKET, ticket_type_id: FROM, slot_status: "issued", checked_in_at: null, released_at: null, email: "" },
      })
    );
    const res = await post({ ticketId: TICKET, toTicketTypeId: TO }, "ptoken");
    expect(res.status).toBe(200);
  });
});
