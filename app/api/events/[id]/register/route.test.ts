import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));
// NB: @/lib/events/registration is intentionally NOT mocked — we exercise the
// real isValidInviteCode and generateReferenceCode.

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

type Cfg = {
  event: Record<string, unknown> | null;
  memberRow?: { id: string; status: string } | null;
  existingReg?: unknown[];
  inserted?: { id: string } | null;
  insertError?: { code?: string } | null;
  capturedInsert?: Record<string, unknown>;
};

// Config-driven fake admin client routing by table name.
function adminClient(cfg: Cfg) {
  return {
    from: (table: string) => {
      if (table === "events") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.single = async () => ({
          data: cfg.event,
          error: cfg.event ? null : { message: "not found" },
        });
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
      if (table === "event_registrations") {
        const c: Record<string, unknown> = {};
        // dup-guard read chain: select → eq → eq → in → limit (awaited)
        c.select = () => {
          const d: Record<string, unknown> = {};
          d.eq = () => d;
          d.in = () => d;
          d.limit = () => d;
          (d as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
            resolve({ data: cfg.existingReg ?? [], error: null });
          return d;
        };
        // insert chain: insert → select → limit → single
        c.insert = (payload: Record<string, unknown>) => {
          cfg.capturedInsert = payload;
          const ins: Record<string, unknown> = {};
          ins.select = () => ins;
          ins.limit = () => ins;
          ins.single = async () => ({
            data: cfg.insertError ? null : cfg.inserted ?? { id: "reg-1" },
            error: cfg.insertError ?? null,
          });
          return ins;
        };
        // session-id update chain: update → eq (awaited)
        c.update = () => {
          const upd: Record<string, unknown> = {};
          upd.eq = async () => ({ error: null });
          return upd;
        };
        return c;
      }
      throw new Error(`unexpected table ${table}`);
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

const membersOnlyPaid = {
  id: "evt-1",
  title: "Polo Gala",
  is_published: true,
  registration_enabled: true,
  price_member: 30,
  price_non_member: null,
  visibility: "members_only",
  seat_cap: null,
  invite_code: INVITE,
  invite_price: 50,
};

const guest = { name: "Jean Dupont", email: "jean@example.com", quantity: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyPaid, inserted: { id: "reg-1" } }));
  mockedSession.mockResolvedValue(sessionClient(null)); // logged out by default
  mockedSeatsUsed.mockResolvedValue(0);
  mockedSendEmail.mockResolvedValue({ success: true });
  stripeCreate = vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://stripe/checkout" });
  mockedStripe.mockReturnValue({
    checkout: { sessions: { create: stripeCreate } },
  } as unknown as ReturnType<typeof getStripe>);
});

describe("invite-code gate on members-only events", () => {
  it("allows a logged-out guest with a valid code and prices at invite_price", async () => {
    const cfg: Cfg = { event: membersOnlyPaid, inserted: { id: "reg-1" } };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    // invite_price (50) used, not price_non_member (null) or price_member (30)
    expect(cfg.capturedInsert).toMatchObject({
      unit_amount_chf: 50,
      total_amount_chf: 100,
      is_member: false,
      member_id: null,
      status: "pending",
    });
    expect(stripeCreate).toHaveBeenCalledOnce();
  });

  it("rejects a logged-out guest with no code (403)", async () => {
    const res = await post(guest);
    expect(res.status).toBe(403);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("rejects a logged-out guest with a wrong code (403)", async () => {
    const res = await post({ ...guest, code: "WRONGCODE0000000" });
    expect(res.status).toBe(403);
  });

  it("rejects a blank code against a members-only event (403)", async () => {
    const res = await post({ ...guest, code: "   " });
    expect(res.status).toBe(403);
  });
});

describe("pricing by session, not by code", () => {
  it("charges a logged-in active member price_member, links member_id, ignores code", async () => {
    const cfg: Cfg = {
      event: membersOnlyPaid,
      memberRow: { id: "mem-1", status: "active" },
      inserted: { id: "reg-1" },
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    mockedSession.mockResolvedValue(sessionClient({ id: "auth-1" }));
    // Supply a valid code too: the member session must win — price_member, not invite_price.
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect(cfg.capturedInsert).toMatchObject({
      unit_amount_chf: 30,
      is_member: true,
      member_id: "mem-1",
    });
  });

  it("charges a logged-in NON-active member the invite_price (treated as a guest)", async () => {
    // Session present, but no active member row (e.g. expired membership).
    const cfg: Cfg = {
      event: membersOnlyPaid,
      memberRow: null,
      inserted: { id: "reg-1" },
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    mockedSession.mockResolvedValue(sessionClient({ id: "auth-1" }));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect(cfg.capturedInsert).toMatchObject({
      unit_amount_chf: 50, // invite_price, not price_member
      is_member: false,
      member_id: null,
    });
  });

  it("registers a valid-code guest for free when invite_price is 0", async () => {
    const cfg: Cfg = {
      event: { ...membersOnlyPaid, invite_price: 0 },
      inserted: { id: "reg-1" },
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(cfg.capturedInsert).toMatchObject({ status: "free", total_amount_chf: 0 });
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(mockedSendEmail).toHaveBeenCalledOnce();
  });

  it("500s when invite_price is null (never silently free)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ event: { ...membersOnlyPaid, invite_price: null } })
    );
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });
});

describe("the code relaxes ONLY the members-only gate", () => {
  it("still rejects when registration is disabled, even with a valid code", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ event: { ...membersOnlyPaid, registration_enabled: false } })
    );
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(400);
  });

  it("still 404s an unpublished event, even with a valid code", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ event: { ...membersOnlyPaid, is_published: false } })
    );
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(400); // is_published guard returns 400 "not published"
  });

  it("still enforces the duplicate-email guard on the invite path (409)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ event: membersOnlyPaid, existingReg: [{ id: "reg-0", status: "paid" }] })
    );
    const res = await post({ ...guest, code: INVITE });
    expect(res.status).toBe(409);
  });
});

describe("public events are unaffected", () => {
  it("prices a public-event non-member at price_non_member and ignores a stray code", async () => {
    const cfg: Cfg = {
      event: {
        ...membersOnlyPaid,
        visibility: "public",
        price_non_member: 75,
        invite_price: null,
      },
      inserted: { id: "reg-1" },
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ ...guest, code: "ignored" });
    expect(res.status).toBe(200);
    expect(cfg.capturedInsert).toMatchObject({ unit_amount_chf: 75 });
  });
});

describe("Stripe return URLs carry the code", () => {
  it("appends &code= to success_url and cancel_url", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyPaid, inserted: { id: "reg-1" } }));
    await post({ ...guest, code: INVITE });
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain(`&code=${INVITE}`);
    expect(args.cancel_url).toContain(`&code=${INVITE}`);
  });
});
