import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
// Also keeps `server-only` out of the module graph, which vitest cannot resolve.
vi.mock("@/lib/analytics/server-errors", () => ({ captureServerException: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { captureServerException } from "@/lib/analytics/server-errors";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const mockedCapture = vi.mocked(captureServerException);

const TICKET = "33333333-3333-3333-3333-333333333333";
const PI_MAIN = "pi_main";
const PI_TOPUP = "pi_topup";

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

let lastUpdate: Record<string, unknown> | null = null;
let updateCount = 0;
let refundCreate: ReturnType<typeof vi.fn>;
let refundList: ReturnType<typeof vi.fn>;
let intentRetrieve: ReturnType<typeof vi.fn>;

type TicketRow = {
  id: string;
  registration_id: string | null;
  ticket_type_id: string | null;
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
  cancellation_status: "requested",
};
const PAID_REG: RegRow = {
  id: "r1",
  status: "paid",
  quantity: 2,
  total_amount_chf: 160,
  stripe_payment_intent_id: PI_MAIN,
};
// One line at CHF 80 a seat → a single ticket refunds 80, not the 160 booking total.
const ITEMS = [{ registration_id: "r1", ticket_type_id: "tt1", unit_amount_chf: 80 }];

interface Opts {
  admins: { id: string; role: string }[];
  ticket?: TicketRow | null;
  ticketAfterUpdate?: { cancellation_status: string | null } | null;
  registration?: RegRow | null;
  items?: Record<string, unknown>[];
  topups?: { stripe_payment_intent_id: string | null }[];
  conversions?: { stripe_payment_intent_id: string | null }[];
  topupError?: unknown;
  updated?: { id: string } | null;
  updateError?: unknown;
}

// Chain shapes used by the route:
//   tickets                        select().eq().eq().limit().maybeSingle()  /  update()…maybeSingle()
//   event_registrations            select().eq().limit().maybeSingle()
//   event_registration_items       select().eq()                    → thenable
//   event_registration_topups      select().eq().not()              → thenable
//   event_ticket_type_conversions  select().eq().not()              → thenable
function adminClient(opts: Opts) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> & { _upd?: boolean } = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.not = () => c;
      c.update = (payload: Record<string, unknown>) => {
        c._upd = true;
        updateCount += 1;
        lastUpdate = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (c._upd) return { data: opts.updated ?? null, error: opts.updateError ?? null };
        if (table === "tickets") {
          // After a lost compare-and-set the route re-reads to tell "someone else settled it"
          // apart from "our write failed".
          if (updateCount > 0 && opts.ticketAfterUpdate !== undefined) {
            return { data: opts.ticketAfterUpdate, error: null };
          }
          return { data: opts.ticket ?? null, error: null };
        }
        if (table === "event_registrations") return { data: opts.registration ?? null, error: null };
        return { data: null, error: null };
      };
      const thenable = (data: unknown, error: unknown = null) => {
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data, error });
      };
      if (table === "admin_users") thenable(opts.admins);
      if (table === "event_registration_items") thenable(opts.items ?? ITEMS);
      if (table === "event_registration_topups") thenable(opts.topups ?? [], opts.topupError ?? null);
      if (table === "event_ticket_type_conversions") thenable(opts.conversions ?? []);
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

/** Give each PaymentIntent a refundable balance, in centimes. */
function withBalances(balances: Record<string, number>) {
  intentRetrieve.mockImplementation(async (id: string) => ({
    id,
    latest_charge: { amount_captured: balances[id] ?? 0, amount_refunded: 0 },
  }));
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
  updateCount = 0;
  refundCreate = vi.fn(async (args: { amount: number }) => ({ id: "re_1", amount: args.amount }));
  refundList = vi.fn(async () => ({ data: [] }));
  intentRetrieve = vi.fn();
  withBalances({ [PI_MAIN]: 16000 });
  mockedStripe.mockReturnValue({
    refunds: { create: refundCreate, list: refundList },
    paymentIntents: { retrieve: intentRetrieve },
  } as never);
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("POST ticket refund", () => {
  it("refunds the seat's price and records what Stripe actually returned", async () => {
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
    expect(await res.json()).toMatchObject({ ok: true, refundedChf: 80, refundId: "re_1" });

    const [args, options] = refundCreate.mock.calls[0];
    expect(args).toMatchObject({ payment_intent: PI_MAIN, amount: 8000 });
    // The ticket id on the refund is what makes "already refunded?" answerable from Stripe
    // long after the idempotency key expires.
    expect(args.metadata).toMatchObject({ ticket_id: TICKET });
    expect(options).toEqual({ idempotencyKey: `evt-ticket-refund-${TICKET}-${PI_MAIN}` });

    expect(lastUpdate).toMatchObject({
      cancellation_status: "refunded",
      refund_amount_chf: 80,
      stripe_refund_id: "re_1",
    });
  });

  it("draws across the booking's other charges when the original is exhausted", async () => {
    // A topped-up booking: the seat's money is on the top-up's PaymentIntent, which the
    // registration row does not name. Refunding the original charge alone used to raise
    // charge_already_refunded and get recorded as a successful refund.
    withBalances({ [PI_MAIN]: 3000, [PI_TOPUP]: 10000 });
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        topups: [{ stripe_payment_intent_id: PI_TOPUP }],
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refundedChf: 80 });

    expect(refundCreate).toHaveBeenCalledTimes(2);
    expect(refundCreate.mock.calls[0][0]).toMatchObject({ payment_intent: PI_MAIN, amount: 3000 });
    expect(refundCreate.mock.calls[1][0]).toMatchObject({ payment_intent: PI_TOPUP, amount: 5000 });
    // Both refunds are recorded, so the seat can be traced in Stripe.
    expect(lastUpdate).toMatchObject({ refund_amount_chf: 80, stripe_refund_id: "re_1,re_1" });
  });

  it("refuses when the booking's charges can't cover the seat, and refunds nothing", async () => {
    withBalances({ [PI_MAIN]: 2000 }); // CHF 20 left against an CHF 80 seat
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, ticket: LIVE_TICKET, registration: PAID_REG })
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/only has CHF 20\.00 left/);
    // Critical: a partial refund recorded as a full one is the defect this route exists to fix.
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toBeNull();
  });

  it("reconciles a refund already issued in Stripe without sending money again", async () => {
    refundList.mockResolvedValue({
      data: [{ id: "re_dash", amount: 8000, metadata: { ticket_id: TICKET } }],
    });
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
    expect(await res.json()).toMatchObject({ ok: true, reconciled: true, refundedChf: 80 });
    expect(refundCreate).not.toHaveBeenCalled();
    // Stripe's own amount, not a derived one — recording a self-derived figure here is how the
    // books drifted before.
    expect(lastUpdate).toMatchObject({ refund_amount_chf: 80, stripe_refund_id: "re_dash" });
  });

  it("records the amount STRIPE returned, not the seat's derived price", async () => {
    // The dashboard refund was partial. The old code wrote the derived 80 regardless.
    refundList.mockResolvedValue({
      data: [{ id: "re_partial", amount: 5000, metadata: { ticket_id: TICKET } }],
    });
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(await res.json()).toMatchObject({ refundedChf: 50 });
    expect(lastUpdate).toMatchObject({ refund_amount_chf: 50 });
  });

  it("closes a comped seat at CHF 0 without calling Stripe", async () => {
    // U7/KTD6: the comp flag is retired. Every historical comp ticket lives on a `free`-status
    // registration (verified against the shared database), which is what the route now relies
    // on to zero the refund instead of the flag.
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: { ...PAID_REG, status: "free" },
        updated: { id: TICKET },
      })
    );
    const res = await post();
    // Refusing would strand the ticket in 'requested' with no way for an admin to close it.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refundedChf: 0, nothingToRefund: true });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toMatchObject({ cancellation_status: "refunded", refund_amount_chf: 0 });
  });

  it("closes a seat whose type resolves no priced line at CHF 0 without falling through to the booking average", async () => {
    // A comp-shaped ticket whose type no longer matches any item line (an archived/hard-deleted
    // type) must not silently refund the booking average — KTD6's specific concern once the
    // comp-flag short-circuit is gone.
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: { ...LIVE_TICKET, ticket_type_id: "tt-gone" },
        registration: PAID_REG,
        items: [],
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, refundedChf: 0, nothingToRefund: true });
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("refuses a priced seat with no payment on record instead of closing it at zero", async () => {
    // The guest is owed CHF 80. Closing it silently would tell the admin nothing was owed —
    // the CHF 560 defect with the sign flipped.
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: { ...PAID_REG, stripe_payment_intent_id: null },
        updated: { id: TICKET },
      })
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no Stripe payment on record/);
    expect(lastUpdate).toBeNull();
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("503s when the booking's other charges can't be read", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        topupError: { message: "db down" },
      })
    );
    const res = await post();
    expect(res.status).toBe(503);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toBeNull();
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
    expect(lastUpdate).toBeNull();
  });

  it("raises a tracked alarm when money moved but the write failed", async () => {
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
    expect(body.refundId).toBe("re_1");
    // A console.log on Railway is not an alarm; this must reach error tracking.
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(String(mockedCapture.mock.calls[0][0])).toMatch(/REFUND ISSUED BUT NOT RECORDED/);
  });

  it("reports a lost race as already settled, not as lost money", async () => {
    // Two admins click at once. The loser's guarded UPDATE matches nothing — but the refund WAS
    // recorded, by the winner. Telling them money moved and wasn't saved is a false alarm.
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: null,
        updateError: null,
        ticketAfterUpdate: { cancellation_status: "refunded" },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyRefunded: true });
    expect(mockedCapture).not.toHaveBeenCalled();
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
    expect(await res.json()).toMatchObject({ ok: true, alreadyRefunded: true });
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("409s a ticket that was never cancelled", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, ticket: { ...LIVE_TICKET, cancellation_status: null } })
    );
    expect((await post()).status).toBe(409);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("404s a ticket belonging to another event", async () => {
    // The lookup is scoped by event_id, so a foreign ticket simply isn't found. This pins the
    // scoping guard, which matters more now that the route moves money.
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, ticket: null }));
    const res = await post();
    expect(res.status).toBe(404);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("400s an invalid ticket id", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    expect((await post("not-a-uuid")).status).toBe(400);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    expect((await post()).status).toBe(401);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  // The route moves money with the same role list that previously only flipped a flag, so the
  // allowlist is pinned in both directions.
  it.each(["super_admin", "team_admin", "events_admin", "finance"])("allows %s", async (role) => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: [{ id: "a1", role }],
        ticket: LIVE_TICKET,
        registration: PAID_REG,
        updated: { id: TICKET },
      })
    );
    expect((await post()).status).toBe(200);
  });

  it.each(["door_staff", "originator", "viewer"])("forbids %s", async (role) => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [{ id: "a1", role }] }));
    expect((await post()).status).toBe(403);
    expect(refundCreate).not.toHaveBeenCalled();
    expect(lastUpdate).toBeNull();
  });
});
