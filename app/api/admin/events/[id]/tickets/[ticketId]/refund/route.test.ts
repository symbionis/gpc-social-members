import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const TICKET = "33333333-3333-3333-3333-333333333333";

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

let lastUpdate: Record<string, unknown> | null = null;
let refundCreate: ReturnType<typeof vi.fn>;

type TicketRow = {
  id: string;
  registration_id: string | null;
  ticket_type_id: string | null;
  is_comp: boolean;
  cancellation_status: string | null;
};
type RegRow = {
  id: string;
  status: string;
  quantity: number;
  total_amount_chf: number;
  stripe_payment_intent_id: string | null;
};

const LIVE_TICKET: TicketRow = {
  id: TICKET,
  registration_id: "r1",
  ticket_type_id: "tt1",
  is_comp: false,
  cancellation_status: "requested",
};
const PAID_REG: RegRow = {
  id: "r1",
  status: "paid",
  quantity: 2,
  total_amount_chf: 160,
  stripe_payment_intent_id: "pi_1",
};
// One line at CHF 80 a seat → a single ticket refunds 80, not the 160 booking total.
const ITEMS = [{ registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 }];

// admin_users → the role gate (thenable). tickets/event_registrations → guarded SELECTs, then
// the UPDATE result once .update() has been called. event_registration_items → a thenable list.
function adminClient(opts: {
  admins: { id: string; role: string }[];
  ticket?: TicketRow | null;
  registration?: RegRow | null;
  items?: Record<string, unknown>[];
  updated?: { id: string } | null;
  updateError?: unknown;
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> & { _upd?: boolean } = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.update = (payload: Record<string, unknown>) => {
        c._upd = true;
        lastUpdate = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (c._upd) return { data: opts.updated ?? null, error: opts.updateError ?? null };
        if (table === "tickets") return { data: opts.ticket ?? null, error: null };
        if (table === "event_registrations") return { data: opts.registration ?? null, error: null };
        return { data: null, error: null };
      };
      if (table === "admin_users") {
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.admins, error: null });
      }
      if (table === "event_registration_items") {
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.items ?? ITEMS, error: null });
      }
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(ticketId = TICKET) {
  const r = new Request(`http://localhost/api/admin/events/evt-1/tickets/${ticketId}/refund`, {
    method: "POST",
  });
  return POST(r as never, { params: Promise.resolve({ id: "evt-1", ticketId }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

beforeEach(() => {
  vi.clearAllMocks();
  lastUpdate = null;
  refundCreate = vi.fn(async () => ({ id: "re_123" }));
  mockedStripe.mockReturnValue({ refunds: { create: refundCreate } } as never);
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("POST ticket refund", () => {
  it("refunds the seat's price through Stripe, then records amount and refund id", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amountChf: 80, refundId: "re_123" });

    // The seat price in centimes, against the booking's PaymentIntent.
    const [args, options] = refundCreate.mock.calls[0];
    expect(args).toMatchObject({ payment_intent: "pi_1", amount: 8000 });
    // Keyed on the ticket so a double-click cannot send the money twice.
    expect(options).toEqual({ idempotencyKey: `evt-ticket-refund-${TICKET}` });

    expect(lastUpdate).toMatchObject({
      cancellation_status: "refunded",
      refund_amount_chf: 80,
      stripe_refund_id: "re_123",
    });
    expect(lastUpdate?.cancellation_refunded_at).toBeTruthy();
  });

  it("rejects a non-admin with 403 and never touches Stripe", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [] }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toBeNull();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    const res = await post();
    expect(res.status).toBe(401);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("400s an invalid ticket id", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    const res = await post("not-a-uuid");
    expect(res.status).toBe(400);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("is idempotent — an already-refunded ticket is a no-op success", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: { ...LIVE_TICKET, cancellation_status: "refunded" },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyRefunded: true });
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("409s a ticket that was never cancelled", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, ticket: { ...LIVE_TICKET, cancellation_status: null } })
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("404s a missing ticket", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, ticket: null }));
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("closes a comped seat at CHF 0 without calling Stripe", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: { ...LIVE_TICKET, is_comp: true },
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    const res = await post();
    // Refusing would strand the ticket in 'requested' with no way for an admin to close it.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amountChf: 0, nothingToRefund: true });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toMatchObject({ cancellation_status: "refunded", refund_amount_chf: 0 });
  });

  it("closes a booking with no Stripe payment rather than refusing", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: { ...PAID_REG, stripe_payment_intent_id: null },
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nothingToRefund: true });
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("does NOT mark the ticket refunded when Stripe declines", async () => {
    refundCreate.mockRejectedValue({ code: "card_error", message: "Refund failed" });
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "Refund failed" });
    // The critical property: a failed refund must never leave a 'refunded' row behind.
    expect(lastUpdate).toBeNull();
  });

  it("reconciles a charge already refunded in the Stripe dashboard without refunding twice", async () => {
    refundCreate.mockRejectedValue({ code: "charge_already_refunded" });
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reconciledOutOfBand: true, refundId: null });
    // Recorded, so finance nets it — but with no refund id, since the app never issued one.
    expect(lastUpdate).toMatchObject({ cancellation_status: "refunded", refund_amount_chf: 80 });
  });

  it("500s naming the refund when the money moved but the write failed", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: null,
        updateError: { message: "db down" },
      })
    );
    const res = await post();
    expect(res.status).toBe(500);
    const body = await res.json();
    // The admin must be able to find the refund; silence here is how the books drift.
    expect(body.refundId).toBe("re_123");
    expect(body.error).toMatch(/re_123/);
  });
});
