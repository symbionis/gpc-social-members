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

type WaitlistEntry = { id: string; email: string; quantity: number | null } | null;
type LiveReg = { waitlist_entry_id: string | null; email: string };

type Cfg = {
  event: Record<string, unknown> | null;
  memberRow?: { id: string; status: string } | null;
  ticketTypes?: TicketType[];
  existingReg?: unknown[];
  rpcError?: { code?: string } | null;
  capturedRpc?: { name: string; args: RpcArgs };
  // Roster-fill assertions (U4): claim_ticket calls and the pending_roster write.
  capturedClaims?: Record<string, unknown>[];
  capturedRosterUpdate?: Record<string, unknown>;
  rosterUpdateError?: boolean;
  // Offer redemption (U6): the event_waitlist row an offer_token resolves to, the
  // paid/free registrations used to derive redeemed state (KTD3), and the
  // fail-loud waitlist_entry_id write on the created registration.
  waitlistEntry?: WaitlistEntry;
  waitlistEntryLookupError?: boolean;
  liveRegs?: LiveReg[];
  liveRegsLookupError?: boolean;
  capturedWaitlistLinkUpdate?: Record<string, unknown>;
  waitlistLinkUpdateError?: boolean;
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
        // Two distinct selects hit this table: the pre-existing duplicate-email
        // guard (select("id")) and U6's redeemed-state lookup for an offer token
        // (select(...waitlist_entry_id...)). Branch on the requested columns so
        // both can be configured independently in one test.
        c.select = (cols?: string) => {
          const d: Record<string, unknown> = {};
          d.eq = () => d;
          d.in = () => d;
          d.limit = () => d;
          const isLiveRegsQuery = typeof cols === "string" && cols.includes("waitlist_entry_id");
          (d as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
            if (isLiveRegsQuery) {
              if (cfg.liveRegsLookupError) {
                return resolve({ data: null, error: { message: "live regs lookup failed" } });
              }
              return resolve({ data: cfg.liveRegs ?? [], error: null });
            }
            return resolve({ data: cfg.existingReg ?? [], error: null });
          };
          return d;
        };
        c.update = (payload: Record<string, unknown>) => {
          const upd: Record<string, unknown> = {};
          upd.eq = async () => {
            if (payload && "pending_roster" in payload) {
              cfg.capturedRosterUpdate = payload;
              if (cfg.rosterUpdateError) return { error: { message: "roster write failed" } };
            }
            if (payload && "waitlist_entry_id" in payload) {
              cfg.capturedWaitlistLinkUpdate = payload;
              if (cfg.waitlistLinkUpdateError) return { error: { message: "waitlist link write failed" } };
            }
            return { error: null };
          };
          return upd;
        };
        return c;
      }
      if (table === "event_waitlist") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.maybeSingle = async () =>
          cfg.waitlistEntryLookupError
            ? { data: null, error: { message: "waitlist entry lookup failed" } }
            : { data: cfg.waitlistEntry ?? null, error: null };
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      // Capture the registration RPC only; seed_lead_attendee (U12) also calls
      // rpc() on the free/paid confirmation path and must not clobber it.
      if (name === "create_event_registration") cfg.capturedRpc = { name, args: args as unknown as RpcArgs };
      if (name === "claim_ticket") (cfg.capturedClaims ??= []).push(args);
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

// Shared by the public-event describe blocks below (nominative attendees, U2):
// posts as a booker named "Lead Booker" <lead@x.ch>, the fixed identity those
// scenarios book against.
function publicPost(cfg: Cfg, body: Record<string, unknown>) {
  mockedAdmin.mockReturnValue(adminClient(cfg));
  return post({ name: "Lead Booker", email: "lead@x.ch", ...body });
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

// quantity 2 = the lead + 1 guest slot; naming is mandatory (R1), so every fixture
// using this shared basket must name that guest slot to reach the behaviour under
// test (pricing, guards, Stripe params) rather than 400ing on the naming gate.
const guest = {
  name: "Jean Dupont",
  email: "jean@example.com",
  items: [{ ticket_type_id: "t1", quantity: 2 }],
  attendees: [{ ticket_type_id: "t1", name: "Guest Person", email: "guest@example.com" }],
};

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
  it("covers R1 bypass: 400s duplicate lines for the same ticket type", async () => {
    // A crafted items:[{t1,19},{t1,1}] would sum to 20 minted tickets while the
    // per-type naming-capacity Map (last-write-wins) only sees quantity 1 —
    // silently skipping mandatory naming. Reject the duplicate outright.
    const res = await post({ ...guest, code: INVITE, items: [{ ticket_type_id: "t1", quantity: 19 }, { ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(stripeCreate).not.toHaveBeenCalled();
  });
  it("400s a lead ticket type that is not in the basket", async () => {
    const res = await post({ ...guest, code: INVITE, leadTicketTypeId: "tX" });
    expect(res.status).toBe(400);
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
      name: "Ann Ace", email: "a@b.com",
      items: [{ ticket_type_id: "t1", quantity: 2 }, { ticket_type_id: "t2", quantity: 3 }],
      leadTicketTypeId: "t1",
      attendees: [
        { ticket_type_id: "t1", name: "Guest One", email: "g1@x.ch" },
        { ticket_type_id: "t2", name: "Guest Two", email: "g2@x.ch" },
        { ticket_type_id: "t2", name: "Guest Three", email: "g3@x.ch" },
        { ticket_type_id: "t2", name: "Guest Four", email: "g4@x.ch" },
      ],
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

describe("nominative attendees (U4)", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adultPaid: TicketType = { id: "t1", title: "Asado", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
  const adultFree: TicketType = { ...adultPaid, price_member: 0, price_non_member: 0 };
  const veg: TicketType = { id: "t2", title: "Veg", price_member: 40, price_non_member: 40, invite_price: null, counts_as_seat: true, archived_at: null };
  const kidFree: TicketType = { id: "tk", title: "Kids", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("free path: fills each named guest inline via claim_ticket", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(cfg.capturedClaims).toHaveLength(1);
    expect(cfg.capturedClaims![0]).toMatchObject({ p_registration_id: "reg-1", p_name: "Ana Adult", p_email: "ana@x.ch", p_ticket_type_id: "t1" });
  });

  it("paid path: persists pending_roster and defers the fill (no inline claim)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    expect(cfg.capturedRosterUpdate?.pending_roster).toEqual([{ ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" }]);
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("paid path: 500s and skips Stripe when the pending_roster write fails", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid], rosterUpdateError: true };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" }],
    });
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("400s an attendee referencing a ticket not in the order", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "tX", name: "Ghost", email: "g@x.ch" }],
    });
    expect(res.status).toBe(400);
  });

  it("400s a one-word booker name — no surname to file them under", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Hallf",
      email: "hallf@x.ch",
      items: [{ ticket_type_id: "t1", quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("400s a one-word adult guest name", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana", email: "ana@x.ch" }],
    });
    expect(res.status).toBe(400);
  });

  it("400s an adult attendee with no email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana Adult" }],
    });
    expect(res.status).toBe(400);
  });

  it("covers AE3/R8: a former child-type attendee now needs a full name and email like any other", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "tk", quantity: 1 }],
      leadTicketTypeId: "t1",
      attendees: [{ ticket_type_id: "tk", name: "Kid Guest", email: "kid@x.ch" }],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(1);
    expect(cfg.capturedClaims![0]).toMatchObject({ p_ticket_type_id: "tk", p_name: "Kid Guest", p_email: "kid@x.ch" });
  });

  it("400s a former child-type attendee with a mononymous name (no more child exemption)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "tk", quantity: 1 }],
      leadTicketTypeId: "t1",
      attendees: [{ ticket_type_id: "tk", name: "Kid" }],
    });
    expect(res.status).toBe(400);
  });

  it("400s a former child-type attendee with no email (no more child exemption)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "tk", quantity: 1 }],
      leadTicketTypeId: "t1",
      attendees: [{ ticket_type_id: "tk", name: "Kid Guest" }],
    });
    expect(res.status).toBe(400);
  });

  it("covers R6: the buyer's own ticket may now be a former child type", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [kidFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "tk", quantity: 1 }],
      leadTicketTypeId: "tk",
    });
    expect(res.status).toBe(200);
  });

  it("requires an email for every named guest", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Ana" }],
    });
    expect(res.status).toBe(400);
  });

  it("400s an over-length attendee name", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "x".repeat(121), email: "a@x.ch" }],
    });
    expect(res.status).toBe(400);
  });

  it("400s more named guests than tickets for a type (accounting for the lead)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }], // lead + 1 → capacity 1
      attendees: [
        { ticket_type_id: "t1", name: "A", email: "a@x.ch" },
        { ticket_type_id: "t1", name: "B", email: "b@x.ch" },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("400s a 2+ adult-type basket with no lead ticket chosen", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid, veg] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "t2", quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("covers R1: with only the lead's own single ticket, no attendees array is required", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    expect(cfg.capturedRosterUpdate).toBeUndefined();
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("covers R1: no attendees array for guest slots is now rejected (naming is mandatory)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 2 }] });
    expect(res.status).toBe(400);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("covers R1: fewer named guests than purchased tickets for a type is rejected", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 3 }], // lead + 2 guests
      attendees: [{ ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" }], // only 1 named
    });
    expect(res.status).toBe(400);
  });

  it("covers AE6: naming stays mandatory on a free event", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 2 }] });
    expect(res.status).toBe(400);
    expect(cfg.capturedClaims).toBeUndefined();
  });
});

describe("U2 — shared email across a household (distinct-email guard removed, R2)", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adultFree: TicketType = { id: "t1", title: "Asado", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };
  const adultPaid: TicketType = { id: "t1", title: "Asado", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };

  it("covers AE1: three differently-named guests sharing one email all reach claimed", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 4 }], // lead + 3 guests
      attendees: [
        { ticket_type_id: "t1", name: "Anna Household", email: "family@x.ch" },
        { ticket_type_id: "t1", name: "Ben Household", email: "family@x.ch" },
        { ticket_type_id: "t1", name: "Clara Household", email: "family@x.ch" },
      ],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(3);
    expect(cfg.capturedClaims!.every((c) => c.p_email === "family@x.ch")).toBe(true);
  });

  it("covers AE2: a guest may reuse the booker's own email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Guest Person", email: "lead@x.ch" }],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(1);
    expect(cfg.capturedClaims![0]).toMatchObject({ p_email: "lead@x.ch" });
  });

  it("covers R1 bypass: 400s two attendees with the same name AND email (would collapse in claim_ticket)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 3 }],
      attendees: [
        { ticket_type_id: "t1", name: "Sam Twin", email: "twins@x.ch" },
        { ticket_type_id: "t1", name: "Sam  TWIN ", email: "twins@x.ch" }, // case + whitespace variant
      ],
    });
    expect(res.status).toBe(400);
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("no longer returns the removed distinct-email error message", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 3 }],
      attendees: [
        { ticket_type_id: "t1", name: "Anna Household", email: "same@x.ch" },
        { ticket_type_id: "t1", name: "Ben Household", email: "same@x.ch" },
      ],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedRosterUpdate?.pending_roster).toEqual([
      { ticket_type_id: "t1", name: "Anna Household", email: "same@x.ch" },
      { ticket_type_id: "t1", name: "Ben Household", email: "same@x.ch" },
    ]);
  });

  it("covers AE7: the booker-level registration guard still blocks a second registration on the same email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree], existingReg: [{ id: "reg-0" }] };
    const res = await publicPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(409);
  });
});

describe("offer redemption (U6)", () => {
  const offerEvent = { ...membersOnlyEvent, visibility: "public" };
  const OFFER_TOKEN = "offer-tok-abc";
  const ENTRY_EMAIL = "invitee@example.com";
  const entryQty2: WaitlistEntry = { id: "wl-1", email: ENTRY_EMAIL, quantity: 2 };

  const dinner: TicketType = { id: "t1", title: "Dinner", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
  const lunch: TicketType = { id: "t2", title: "Lunch", price_member: 50, price_non_member: 50, invite_price: null, counts_as_seat: true, archived_at: null };
  const freeType: TicketType = { id: "t1", title: "Dinner", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };
  const merch: TicketType = { id: "t3", title: "Merch", price_member: 10, price_non_member: 10, invite_price: null, counts_as_seat: false, archived_at: null };

  function offerPost(cfg: Cfg, body: Record<string, unknown>) {
    mockedAdmin.mockReturnValue(adminClient(cfg));
    // Body email deliberately differs from the entry's — the whole point of the
    // pin (KTD8) is that a crafted body email must not survive to the RPC/Stripe.
    return post({ name: "Buyer Person", email: "buyer-crafted@example.com", offer_token: OFFER_TOKEN, ...body });
  }

  // --- Quantity lock (R6, an upper bound not exact equality) — added first per
  // the plan's Execution note: security-relevant and trivially satisfiable by an
  // implementation that only checks the client. ---
  describe("quantity lock", () => {
    it("covers AE2: a basket totalling more than the entry's quantity is rejected and creates nothing", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 3 }] });
      expect(res.status).toBe(400);
      expect(cfg.capturedRpc).toBeUndefined();
      expect(stripeCreate).not.toHaveBeenCalled();
    });

    it("covers AE9: a basket totalling less than the entry's quantity is accepted", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
      expect(res.status).toBe(200);
    });

    it("a basket of 0 against an offer for 2 returns 400", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 0 }] });
      expect(res.status).toBe(400);
    });

    it("covers AE1: an offer for 2 x Dinner redeemed as 2 x Lunch is accepted and priced as Lunch", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner, lunch], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, {
        items: [{ ticket_type_id: "t2", quantity: 2 }],
        leadTicketTypeId: "t2",
        attendees: [{ ticket_type_id: "t2", name: "Guest Person", email: "guest@example.com" }],
      });
      expect(res.status).toBe(200);
      expect(cfg.capturedRpc?.args.p_items[0]).toMatchObject({ ticket_type_id: "t2", unit_amount_chf: 50, quantity: 2 });
    });
  });

  // --- Email pin (KTD8): the entry's email, never the body's, reaches every
  // downstream use. Added alongside the quantity lock per the Execution note. ---
  describe("email pin", () => {
    it("covers AE3: creates the registration with the entry's email, not the body's", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(cfg.capturedRpc?.args).toMatchObject({});
      expect((cfg.capturedRpc?.args as unknown as { p_email: string }).p_email).toBe(ENTRY_EMAIL);
    });

    it("the Stripe session is created with the entry's email as customer_email", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
      expect(stripeCreate.mock.calls[0][0].customer_email).toBe(ENTRY_EMAIL);
    });
  });

  it("rejects a requested type with counts_as_seat false (KTD6)", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [merch], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t3", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("rejects a requested type belonging to another event (IDOR)", async () => {
    // The ticket-types mock returns whatever `ticketTypes` is configured with,
    // regardless of the `.in(ids)` filter — matching the pre-existing IDOR test's
    // shape (line ~278): request two ids while the fixture only "has" one, so the
    // route's own `types.length < ids.length` guard is what fires.
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, {
      items: [{ ticket_type_id: "t1", quantity: 1 }, { ticket_type_id: "tX", quantity: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unresolvable offer token", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: null };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
  });

  it("rejects a token whose entry is already redeemed", async () => {
    const cfg: Cfg = {
      event: offerEvent,
      ticketTypes: [dinner],
      waitlistEntry: entryQty2,
      liveRegs: [{ waitlist_entry_id: "wl-1", email: ENTRY_EMAIL }],
    };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
  });

  it("with one seat free and an offer for two, a basket of 1 succeeds and a basket of 2 returns 409 with the existing sold-out message", async () => {
    const cappedEvent = { ...offerEvent, seat_cap: 5 };
    mockedSeatsUsed.mockResolvedValue(4); // 1 seat free

    const okCfg: Cfg = { event: cappedEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const okRes = await offerPost(okCfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(okRes.status).toBe(200);

    const fullCfg: Cfg = { event: cappedEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const fullRes = await offerPost(fullCfg, {
      items: [{ ticket_type_id: "t1", quantity: 2 }],
      attendees: [{ ticket_type_id: "t1", name: "Guest Person", email: "guest@example.com" }],
    });
    expect(fullRes.status).toBe(409);
    expect((await fullRes.json()).error).toMatch(/tickets? remaining/i);
  });

  it("a successful paid registration carries waitlist_entry_id", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(cfg.capturedWaitlistLinkUpdate).toEqual({ waitlist_entry_id: "wl-1" });
  });

  it("a zero-total offer redemption creates a free registration carrying waitlist_entry_id and skips Stripe", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [freeType], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(cfg.capturedWaitlistLinkUpdate).toEqual({ waitlist_entry_id: "wl-1" });
  });

  it("a failure writing waitlist_entry_id on the paid path returns 500 and never reaches Stripe", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("a failure writing waitlist_entry_id on the free path returns 500 and does not confirm the registration", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [freeType], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    const res = await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("the Stripe success and cancel URLs carry the offer token", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    await offerPost(cfg, { items: [{ ticket_type_id: "t1", quantity: 1 }] });
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain(`/public/offers/${OFFER_TOKEN}`);
    expect(args.cancel_url).toContain(`/public/offers/${OFFER_TOKEN}`);
  });

  it("a request with no offer_token behaves exactly as today (email not pinned, own event page URLs)", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({ name: "Lead Booker", email: "lead@x.ch", items: [{ ticket_type_id: "t1", quantity: 1 }] });
    expect(res.status).toBe(200);
    expect((cfg.capturedRpc?.args as unknown as { p_email: string }).p_email).toBe("lead@x.ch");
    expect(cfg.capturedWaitlistLinkUpdate).toBeUndefined();
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain("/public/events/evt-1");
  });
});
