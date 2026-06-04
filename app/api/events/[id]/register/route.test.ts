import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));
// @/lib/events/registration is NOT mocked — real isValidInviteCode / generateReferenceCode.

import { POST } from "@/app/api/events/[id]/register/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSession = vi.mocked(createClient);
const mockedStripe = vi.mocked(getStripe);
const mockedSendEmail = vi.mocked(sendEventRegistrationConfirmation);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

const INVITE = "ABCD1234WXYZ5678";

type TicketType = {
  id: string;
  title: string;
  price_member: number | null;
  price_non_member: number | null;
  invite_price: number | null;
  counts_as_seat: boolean;
  archived_at: string | null;
};

type RpcArgs = { p_status: string; p_is_member: boolean; p_member_id: string | null; p_items: { ticket_type_id: string; unit_amount_chf: number; line_total_chf: number; quantity: number }[] };

type Cfg = {
  event: Record<string, unknown> | null;
  memberRow?: { id: string; status: string } | null;
  ticketTypes?: TicketType[];
  existingReg?: unknown[];
  rpcError?: { code?: string } | null;
  capturedRpc?: { name: string; args: RpcArgs };
};

function adminClient(cfg: Cfg) {
  return {
    from: (table: string) => {
      if (table === "events") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.single = async () => ({ data: cfg.event, error: cfg.event ? null : { message: "not found" } });
        return c;
      }
      if (table === "members") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.maybeSingle = async () => ({ data: cfg.memberRow ?? null, error: null });
        return c;
      }
      if (table === "event_ticket_types") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.in = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: cfg.ticketTypes ?? [], error: null });
        return c;
      }
      if (table === "event_registrations") {
        const c: Record<string, unknown> = {};
        c.select = () => {
          const d: Record<string, unknown> = {};
          d.eq = () => d;
          d.in = () => d;
          d.limit = () => d;
          (d as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
            resolve({ data: cfg.existingReg ?? [], error: null });
          return d;
        };
        c.update = () => {
          const upd: Record<string, unknown> = {};
          upd.eq = async () => ({ error: null });
          return upd;
        };
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: RpcArgs) => {
      // Capture the registration RPC only; seed_lead_attendee (U12) also calls
      // rpc() on the free/paid confirmation path and must not clobber it.
      if (name === "create_event_registration") cfg.capturedRpc = { name, args };
      return Promise.resolve({ data: cfg.rpcError ? null : "reg-1", error: cfg.rpcError ?? null });
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function sessionClient(user: { id: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

let stripeCreate: ReturnType<typeof vi.fn>;

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/events/evt-1/register", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const membersOnlyEvent = {
  id: "evt-1",
  is_published: true,
  registration_enabled: true,
  visibility: "members_only",
  seat_cap: null,
  invite_code: INVITE,
};

const standardType: TicketType = {
  id: "t1",
  title: "Standard",
  price_member: 30,
  price_non_member: null,
  invite_price: 50,
  counts_as_seat: true,
  archived_at: null,
};

const guest = { name: "Jean Dupont", email: "jean@example.com", items: [{ ticket_type_id: "t1", quantity: 2 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyEvent, ticketTypes: [standardType] }));
  mockedSession.mockResolvedValue(sessionClient(null));
  mockedSeatsUsed.mockResolvedValue(0);
  mockedSendEmail.mockResolvedValue({ success: true });
  stripeCreate = vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://stripe/checkout" });
  mockedStripe.mockReturnValue({ checkout: { sessions: { create: stripeCreate } } } as unknown as ReturnType<typeof getStripe>);
});

describe("invite-code gate + per-type pricing on members-only events", () => {
  it("prices a valid-code guest at the type's invite_price", async () => {
    const cfg: Cfg = { event: membersOnlyEvent, ticketTypes: [standardType] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    expect(cfg.capturedRpc?.name).toBe("create_event_registration");
    expect(cfg.capturedRpc?.args.p_items[0]).toMatchObject({ unit_amount_chf: 50, line_total_chf: 100, quantity: 2 });
    expect(cfg.capturedRpc?.args).toMatchObject({ p_status: "pending", p_is_member: false, p_member_id: null });
  });

  it("rejects a logged-out guest with no / wrong / blank code (403)", async () => {
    expect((await post(guest)).status).toBe(403);
    expect((await post({ ...guest, code: "WRONGCODE0000000" })).status).toBe(403);
    expect((await post({ ...guest, code: "   " })).status).toBe(403);
    expect(stripeCreate).not.toHaveBeenCalled();
  });
});

describe("pricing by session, not by code", () => {
  it("charges a logged-in active member the member price, links member_id, ignores code", async () => {
    const cfg: Cfg = { event: membersOnlyEvent, ticketTypes: [standardType], memberRow: { id: "mem-1", status: "active" } };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    mockedSession.mockResolvedValue(sessionClient({ id: "auth-1" }));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect(cfg.capturedRpc?.args.p_items[0].unit_amount_chf).toBe(30); // price_member, not invite_price
    expect(cfg.capturedRpc?.args).toMatchObject({ p_is_member: true, p_member_id: "mem-1" });
  });

  it("charges a logged-in non-active member the invite price (guest)", async () => {
    const cfg: Cfg = { event: membersOnlyEvent, ticketTypes: [standardType], memberRow: null };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    mockedSession.mockResolvedValue(sessionClient({ id: "auth-1" }));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect(cfg.capturedRpc?.args.p_items[0].unit_amount_chf).toBe(50);
    expect(cfg.capturedRpc?.args.p_is_member).toBe(false);
  });

  it("registers free (no Stripe) when the resolved price is 0", async () => {
    const cfg: Cfg = { event: membersOnlyEvent, ticketTypes: [{ ...standardType, invite_price: 0 }] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(cfg.capturedRpc?.args.p_status).toBe("free");
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(mockedSendEmail).toHaveBeenCalledOnce();
  });

  it("500s (never silently free) when the resolved price column is null", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyEvent, ticketTypes: [{ ...standardType, invite_price: null }] }));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });
});

describe("the code relaxes ONLY the members-only gate", () => {
  it("still rejects when registration is disabled", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: { ...membersOnlyEvent, registration_enabled: false }, ticketTypes: [standardType] }));
    expect((await post({ ...guest, code: INVITE })).status).toBe(400);
  });
  it("still 400s an unpublished event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: { ...membersOnlyEvent, is_published: false }, ticketTypes: [standardType] }));
    expect((await post({ ...guest, code: INVITE })).status).toBe(400);
  });
  it("still enforces the duplicate-email guard (409)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyEvent, ticketTypes: [standardType], existingReg: [{ id: "reg-0" }] }));
    expect((await post({ ...guest, code: INVITE })).status).toBe(409);
  });
});

describe("basket validation + IDOR / archived guards", () => {
  it("400s an empty basket", async () => {
    expect((await post({ ...guest, items: [] })).status).toBe(400);
  });
  it("400s a negative quantity (no arithmetic-abuse path)", async () => {
    const res = await post({ ...guest, items: [{ ticket_type_id: "t1", quantity: 11 }, { ticket_type_id: "t1", quantity: -1 }] });
    expect(res.status).toBe(400);
  });
  it("400s a total over the 20-ticket cap", async () => {
    expect((await post({ ...guest, items: [{ ticket_type_id: "t1", quantity: 21 }] })).status).toBe(400);
  });
  it("400s a ticket type that does not belong to the event (IDOR)", async () => {
    // valid code clears the members-only gate; then requested 't1'+'tX' but only
    // 't1' is returned (event-scoped) → fewer than requested → 400.
    const res = await post({ ...guest, code: INVITE, items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "tX", quantity: 1 }] });
    expect(res.status).toBe(400);
  });
  it("400s an archived ticket type", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyEvent, ticketTypes: [{ ...standardType, archived_at: "2026-05-01T00:00:00Z" }] }));
    expect((await post({ ...guest, code: INVITE })).status).toBe(400);
  });
});

describe("multi-type basket + Stripe lines", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adult: TicketType = { id: "t1", title: "Standard", price_member: 80, price_non_member: 120, invite_price: null, counts_as_seat: true, archived_at: null };
  const kidsFree: TicketType = { id: "t2", title: "Kids", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("prices a public non-member per type and omits free lines from Stripe", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adult, kidsFree] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "A", email: "a@b.com",
      items: [{ ticket_type_id: "t1", quantity: 2 }, { ticket_type_id: "t2", quantity: 3 }],
    });
    expect(res.status).toBe(200);
    // both lines recorded in the registration, but Stripe gets only the paid one
    expect(cfg.capturedRpc?.args.p_items).toHaveLength(2);
    const lineItems = stripeCreate.mock.calls[0][0].line_items;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].price_data.unit_amount).toBe(12000); // 120 * 100 (non-member adult)
    expect(lineItems[0].quantity).toBe(2);
  });
});

describe("Stripe return URLs carry the code", () => {
  it("appends &code= to success and cancel urls", async () => {
    await post({ ...guest, code: INVITE });
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain(`&code=${INVITE}`);
    expect(args.cancel_url).toContain(`&code=${INVITE}`);
  });
});
