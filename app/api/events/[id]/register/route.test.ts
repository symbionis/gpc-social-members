import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));
// Mocked for its `server-only` import, which will not resolve under vitest.
vi.mock("@/lib/analytics/server-errors", () => ({
  captureServerException: vi.fn(),
}));
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

type WaitlistEntry = {
  id: string;
  email: string;
  quantity: number | null;
  offer_token?: string;
  event_id?: string;
} | null;
type LiveReg = { waitlist_entry_id: string | null; email: string };

type Cfg = {
  event: Record<string, unknown> | null;
  memberRow?: { id: string; status: string } | null;
  ticketTypes?: TicketType[];
  existingReg?: unknown[];
  rpcError?: { code?: string } | null;
  capturedRpc?: { name: string; args: RpcArgs };
  // Roster-fill assertions (U2): claim_ticket calls (buyer + guests alike) and the
  // pending_roster write.
  capturedClaims?: Record<string, unknown>[];
  capturedRosterUpdate?: Record<string, unknown>;
  rosterUpdateError?: boolean;
  // Offer redemption (U6): the event_waitlist row an offer_token resolves to, the
  // paid/free registrations used to derive redeemed state (KTD3), and the
  // fail-loud waitlist_entry_id write on the created registration.
  waitlistEntry?: WaitlistEntry;
  capturedWaitlistFilters?: Record<string, unknown>;
  waitlistEntryLookupError?: boolean;
  liveRegs?: LiveReg[];
  liveRegsLookupError?: boolean;
  capturedWaitlistLinkUpdate?: Record<string, unknown>;
  waitlistLinkUpdateError?: boolean;
  capturedRegistrationDelete?: string;
  registrationDeleteError?: boolean;
  // markLeadTickets (U2/KTD9): the is_lead flip's UPDATE payload.
  capturedLeadMark?: Record<string, unknown>;
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
        c.delete = () => {
          const del: Record<string, unknown> = {};
          del.eq = async (_col: string, id: string) => {
            cfg.capturedRegistrationDelete = id;
            if (cfg.registrationDeleteError) return { error: { message: "rollback delete failed" } };
            return { error: null };
          };
          return del;
        };
        return c;
      }
      if (table === "event_waitlist") {
        // The filters are RECORDED and honoured, not ignored. The offer-token lookup
        // is scoped by `.eq("event_id", eventId)` — the only thing standing between an
        // unauthenticated, long-lived token minted for event A and a redemption against
        // event B. A mock that swallowed `.eq` would let that guard be deleted with the
        // suite still green.
        const filters: Record<string, unknown> = {};
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          filters[col] = val;
          return c;
        };
        c.limit = () => c;
        c.maybeSingle = async () => {
          cfg.capturedWaitlistFilters = { ...filters };
          if (cfg.waitlistEntryLookupError) {
            return { data: null, error: { message: "waitlist entry lookup failed" } };
          }
          const entry = cfg.waitlistEntry ?? null;
          if (!entry) return { data: null, error: null };
          // Mimic Postgres: a row is returned only if it satisfies every filter.
          const matches =
            (!("offer_token" in filters) || filters.offer_token === entry.offer_token) &&
            (!("event_id" in filters) || filters.event_id === entry.event_id);
          return { data: matches ? entry : null, error: null };
        };
        return c;
      }
      if (table === "tickets") {
        // markLeadTickets (U2/KTD3/KTD9): a plain UPDATE, not an RPC — recorded for
        // tests that care, otherwise just a harmless no-op chain.
        const c: Record<string, unknown> = {};
        c.update = (payload: Record<string, unknown>) => {
          cfg.capturedLeadMark = payload;
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.is = () => chain;
          (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) => resolve({ error: null });
          return chain;
        };
        return c;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
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

// A person entry: { name, email, ticketTypeIds }.
function person(name: string, email: string, ticketTypeIds: string[]) {
  return { name, email, ticketTypeIds };
}

// N distinct people, one ticket of `ticketTypeId` each — for tests that only care
// about a headcount (bounds, invite limit), not identity.
function distinctPeople(n: number, ticketTypeId: string, prefix = "Guest") {
  return Array.from({ length: n }, (_, i) => person(`${prefix}${i} Person`, `${prefix.toLowerCase()}${i}@x.ch`, [ticketTypeId]));
}

// Shared by the public-event describe blocks below (nominative attendees, U2):
// posts as a booker named "Lead Booker" <lead@x.ch>, the fixed identity those
// scenarios book against. Person zero is always overridden server-side to match
// the top-level name/email (KTD3), so a fixture's people[0] name/email is
// cosmetic — only its ticketTypeIds matter.
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
  max_tickets_invite: null,
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

// The buyer (Jean Dupont) plus one named guest, both on t1 — the people-contract
// equivalent of the old items:[{t1,qty:2}] + attendees:[{t1,"Guest Person"}] fixture.
// Naming is mandatory (R1), so every fixture using this shared order must name that
// guest slot to reach the behaviour under test (pricing, guards, Stripe params)
// rather than 400ing on the naming gate.
const guest = {
  name: "Jean Dupont",
  email: "jean@example.com",
  people: [
    person("Jean Dupont", "jean@example.com", ["t1"]),
    person("Guest Person", "guest@example.com", ["t1"]),
  ],
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

describe("order shape + bounds + IDOR / archived guards", () => {
  it("400s an empty order", async () => {
    expect((await post({ ...guest, people: [] })).status).toBe(400);
  });
  it("400s an order over the 20-people cap", async () => {
    const res = await post({ ...guest, people: distinctPeople(21, "t1") });
    expect(res.status).toBe(400);
  });
  it("400s a ticket type that does not belong to the event (IDOR)", async () => {
    // valid code clears the members-only gate; then one person references 't1'
    // (known) and another references 'tX' (foreign) — the mock's event_ticket_types
    // fixture only ever has 't1', so the returned set is smaller than requested.
    const res = await post({
      ...guest,
      code: INVITE,
      people: [person("Jean Dupont", "jean@example.com", ["t1"]), person("Ghost Guest", "g@x.ch", ["tX"])],
    });
    expect(res.status).toBe(400);
  });
  it("400s an archived ticket type", async () => {
    mockedAdmin.mockReturnValue(adminClient({ event: membersOnlyEvent, ticketTypes: [{ ...standardType, archived_at: "2026-05-01T00:00:00Z" }] }));
    expect((await post({ ...guest, code: INVITE })).status).toBe(400);
  });
});

describe("multi-type order + Stripe lines", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adult: TicketType = { id: "t1", title: "Standard", price_member: 80, price_non_member: 120, invite_price: null, counts_as_seat: true, archived_at: null };
  const kidsFree: TicketType = { id: "t2", title: "Kids", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("prices a public non-member per type and omits free lines from Stripe", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adult, kidsFree] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Ann Ace",
      email: "a@b.com",
      people: [
        person("Ann Ace", "a@b.com", ["t1"]),
        person("Guest One", "g1@x.ch", ["t1"]),
        person("Guest Two", "g2@x.ch", ["t2"]),
        person("Guest Three", "g3@x.ch", ["t2"]),
        person("Guest Four", "g4@x.ch", ["t2"]),
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

describe("nominative attendees, buyer included (U2/KTD3)", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adultPaid: TicketType = { id: "t1", title: "Asado", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
  const adultFree: TicketType = { ...adultPaid, price_member: 0, price_non_member: 0 };
  const kidFree: TicketType = { id: "tk", title: "Kids", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("free path: claims every person, buyer included, via claim_ticket", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ana Adult", "ana@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // Under the people contract nothing seeds the buyer separately — they are
    // claimed the same way as Ana, so both calls show up here.
    expect(cfg.capturedClaims).toHaveLength(2);
    expect(cfg.capturedClaims).toContainEqual(
      expect.objectContaining({ p_registration_id: "reg-1", p_name: "Lead Booker", p_email: "lead@x.ch", p_ticket_type_id: "t1" })
    );
    expect(cfg.capturedClaims).toContainEqual(
      expect.objectContaining({ p_registration_id: "reg-1", p_name: "Ana Adult", p_email: "ana@x.ch", p_ticket_type_id: "t1" })
    );
  });

  it("paid path: persists the WHOLE order (buyer + guest) to pending_roster and defers the fill", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ana Adult", "ana@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    expect(cfg.capturedRosterUpdate?.pending_roster).toEqual([
      { ticket_type_id: "t1", name: "Lead Booker", email: "lead@x.ch" },
      { ticket_type_id: "t1", name: "Ana Adult", email: "ana@x.ch" },
    ]);
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("paid path: 500s and skips Stripe when the pending_roster write fails", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid], rosterUpdateError: true };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ana Adult", "ana@x.ch", ["t1"])],
    });
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("400s a person referencing a ticket not in the order", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ghost", "g@x.ch", ["tX"])],
    });
    expect(res.status).toBe(400);
  });

  it("400s a one-word booker name — no surname to file them under", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Hallf",
      email: "hallf@x.ch",
      people: [person("Hallf", "hallf@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
  });

  it("400s a one-word adult guest name", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ana", "ana@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
  });

  it("400s an adult attendee with no email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Ana Adult", "", ["t1"])],
    });
    expect(res.status).toBe(400);
  });

  it("covers AE3/R8: a former child-type attendee now needs a full name and email like any other", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Kid Guest", "kid@x.ch", ["tk"])],
    });
    expect(res.status).toBe(200);
    // Buyer's own claim (t1) plus the kid's (tk) — no more one-fewer-name arithmetic.
    expect(cfg.capturedClaims).toHaveLength(2);
    expect(cfg.capturedClaims).toContainEqual(
      expect.objectContaining({ p_ticket_type_id: "tk", p_name: "Kid Guest", p_email: "kid@x.ch" })
    );
  });

  it("400s a former child-type attendee with a mononymous name (no more child exemption)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Kid", "kid@x.ch", ["tk"])],
    });
    expect(res.status).toBe(400);
  });

  it("400s a former child-type attendee with no email (no more child exemption)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, kidFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Kid Guest", "", ["tk"])],
    });
    expect(res.status).toBe(400);
  });

  it("covers R6: the buyer's own ticket may now be a former child type", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [kidFree] };
    const res = await publicPost(cfg, { people: [person("Lead Booker", "lead@x.ch", ["tk"])] });
    expect(res.status).toBe(200);
  });

  it("400s an over-length attendee name", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("x".repeat(121), "a@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
  });

  it("400s when the buyer picks no ticket type at all", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, { people: [person("Lead Booker", "lead@x.ch", [])] });
    expect(res.status).toBe(400);
  });

  it("covers R1/R2: a lone buyer with only their own single ticket still lands in pending_roster (nothing seeds it separately)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, { people: [person("Lead Booker", "lead@x.ch", ["t1"])] });
    expect(res.status).toBe(200);
    expect((await res.json()).checkout_url).toBe("https://stripe/checkout");
    expect(cfg.capturedRosterUpdate?.pending_roster).toEqual([
      { ticket_type_id: "t1", name: "Lead Booker", email: "lead@x.ch" },
    ]);
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("covers AE6: naming stays mandatory on a free event (a blank person name is refused)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("", "guest@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
    expect(cfg.capturedClaims).toBeUndefined();
  });
});

describe("shared email across a household + multi-day (distinct-email guard removed, R2/KD4)", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public" };
  const adultFree: TicketType = { id: "t1", title: "Asado", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };
  const adultPaid: TicketType = { id: "t1", title: "Asado", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
  const satFree: TicketType = { id: "t2", title: "Saturday", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("covers AE1: three differently-named guests sharing one email all reach claimed", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [
        person("Lead Booker", "lead@x.ch", ["t1"]),
        person("Anna Household", "family@x.ch", ["t1"]),
        person("Ben Household", "family@x.ch", ["t1"]),
        person("Clara Household", "family@x.ch", ["t1"]),
      ],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(4); // buyer + 3 household guests
    expect(cfg.capturedClaims!.filter((c) => c.p_email === "family@x.ch")).toHaveLength(3);
  });

  it("covers AE2: a guest may reuse the booker's own email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Guest Person", "lead@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(2);
    expect(cfg.capturedClaims).toContainEqual(expect.objectContaining({ p_name: "Guest Person", p_email: "lead@x.ch" }));
  });

  // The booker's own seat is not special any more — it is just people[0] — and
  // validateOrder's own per-(name,email,type) identity check is what refuses a
  // second entry naming the same person onto the same type. This is the collision
  // that actually happened in production before it existed: four bookings (two on
  // ENLIGHTEN Summit, two on Breath & Polo) sold a second seat that claim_ticket
  // then declined to name, returning already=true.
  it("400s a booker named a SECOND time on their own ticket type (duplicate_ticket_type_for_person)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Lead Booker", "lead@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(
      expect.objectContaining({ rule: "duplicate_ticket_type_for_person", personIndex: 1 })
    );
    // Refused before anything was created — no registration, no seats, no claim.
    expect(cfg.capturedRpc).toBeUndefined();
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("folds case and whitespace when matching the booker's own identity", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("lead  BOOKER", "LEAD@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
  });

  // A ticket is per head: the route passes maxTicketsPerPerson: 1, so the buyer holding
  // two types is refused. The two-types-in-one-entry SHAPE is still what a multi-day
  // event would use (KD4) and `ticketIdentityKey` still keys on the type — nothing marks
  // an event multi-day yet, so no caller may produce it. Raising the bound is what
  // re-enables this, not a change here.
  it("400s the booker holding a second ticket type in the same entry (one ticket per head)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, satFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1", "t2"])],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(
      expect.objectContaining({
        rule: "too_many_ticket_types_for_person",
        personIndex: 0,
        field: "ticketTypeIds",
      })
    );
    expect(cfg.capturedClaims).toBeUndefined();
  });

  // The single-ticket buyer that replaces it — still the only place the free path's
  // markLeadTickets call is asserted rather than merely captured by the mock (KTD3/KTD9:
  // neither mint nor claim_ticket sets is_lead now that the buyer is people[0]).
  it("mints and lead-marks a single-ticket booker on the free path", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, satFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(1);
    expect(cfg.capturedClaims).toContainEqual(
      expect.objectContaining({ p_name: "Lead Booker", p_email: "lead@x.ch", p_ticket_type_id: "t1" })
    );
    expect(cfg.capturedLeadMark).toEqual({ is_lead: true });
  });

  // Same bound applies to a guest row, not just the buyer.
  it("400s one guest holding two different ticket types in one entry", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, satFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Partner Person", "shared@x.ch", ["t1", "t2"])],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(
      expect.objectContaining({ rule: "too_many_ticket_types_for_person", personIndex: 1 })
    );
    expect(cfg.capturedClaims).toBeUndefined();
  });

  // Two people on two different types is the shape that replaces multi-day-in-one-row:
  // still one claim each, still one entry, no per-person bound breached.
  it("allows two people each holding a different ticket type", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree, satFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Partner Person", "shared@x.ch", ["t2"])],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedClaims).toHaveLength(2);
  });

  it("400s two people with the same name AND email on the same type (would collapse in claim_ticket)", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [
        person("Lead Booker", "lead@x.ch", ["t1"]),
        person("Sam Twin", "twins@x.ch", ["t1"]),
        person("Sam  TWIN ", "twins@x.ch", ["t1"]), // case + whitespace variant
      ],
    });
    expect(res.status).toBe(400);
    expect(cfg.capturedClaims).toBeUndefined();
  });

  it("no longer returns the removed distinct-email error message — two differently-named guests sharing an email reach pending_roster", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [
        person("Lead Booker", "lead@x.ch", ["t1"]),
        person("Anna Household", "same@x.ch", ["t1"]),
        person("Ben Household", "same@x.ch", ["t1"]),
      ],
    });
    expect(res.status).toBe(200);
    expect(cfg.capturedRosterUpdate?.pending_roster).toEqual([
      { ticket_type_id: "t1", name: "Lead Booker", email: "lead@x.ch" },
      { ticket_type_id: "t1", name: "Anna Household", email: "same@x.ch" },
      { ticket_type_id: "t1", name: "Ben Household", email: "same@x.ch" },
    ]);
  });

  it("covers AE7: the booker-level registration guard still blocks a second registration on the same email", async () => {
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree], existingReg: [{ id: "reg-0" }] };
    const res = await publicPost(cfg, { people: [person("Lead Booker", "lead@x.ch", ["t1"])] });
    expect(res.status).toBe(409);
  });
});

describe("invite-rate limit (U8's events.max_tickets_invite — KD2/KD3/KTD7)", () => {
  const invitePublicEvent = { ...membersOnlyEvent, visibility: "members_only" as const, max_tickets_invite: 1 };
  const dayPass: TicketType = { id: "t1", title: "Day Pass", price_member: 0, price_non_member: null, invite_price: 0, counts_as_seat: true, archived_at: null };
  const satPass: TicketType = { id: "t2", title: "Saturday", price_member: 0, price_non_member: null, invite_price: 0, counts_as_seat: true, archived_at: null };

  // AE3 measured the invite limit in PEOPLE, not tickets — provable back when one person
  // could hold two types. With maxTicketsPerPerson: 1 the two counts are always equal, so
  // that distinction is no longer observable from outside; the limit is still applied to
  // `people.length` in the route. What IS observable is that the multi-type shape is now
  // refused as a per-person violation before the invite limit is ever consulted.
  it("400s a two-ticket-type buyer on the invite path before the rate limit is reached", async () => {
    const cfg: Cfg = { event: invitePublicEvent, ticketTypes: [dayPass, satPass] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      code: INVITE,
      people: [person("Lead Booker", "lead@x.ch", ["t1", "t2"])],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(
      expect.objectContaining({ rule: "too_many_ticket_types_for_person", personIndex: 0 })
    );
    expect(body.violations).not.toContainEqual(
      expect.objectContaining({ rule: "invite_rate_limit" })
    );
  });

  it("admits a single-ticket buyer at exactly the invite limit of 1", async () => {
    const cfg: Cfg = { event: invitePublicEvent, ticketTypes: [dayPass, satPass] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      code: INVITE,
      people: [person("Lead Booker", "lead@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
  });

  it("covers AE3: an order exceeding the invite-rate limit is refused as an order-scoped violation", async () => {
    const cfg: Cfg = { event: invitePublicEvent, ticketTypes: [dayPass] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      code: INVITE,
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Guest Person", "guest@x.ch", ["t1"])],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(
      expect.objectContaining({ rule: "invite_rate_limit", personIndex: null, field: null })
    );
    expect(cfg.capturedRpc).toBeUndefined();
  });

  it("the SAME order at the member rate is accepted (the limit applies only to the invite rate)", async () => {
    const cfg: Cfg = {
      event: invitePublicEvent,
      ticketTypes: [{ ...dayPass, price_member: 0 }],
      memberRow: { id: "mem-1", status: "active" },
    };
    mockedSession.mockResolvedValue(sessionClient({ id: "auth-1" }));
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Guest Person", "guest@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
  });

  it("a null limit means unlimited", async () => {
    const cfg: Cfg = { event: { ...invitePublicEvent, max_tickets_invite: null }, ticketTypes: [dayPass] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      code: INVITE,
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), ...distinctPeople(5, "t1")],
    });
    expect(res.status).toBe(200);
  });
});

describe("seat capacity still refuses an over-capacity order", () => {
  const publicEvent = { ...membersOnlyEvent, visibility: "public", seat_cap: 5 };
  const adultFree: TicketType = { id: "t1", title: "Asado", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };

  it("409s when the order would exceed the remaining seats", async () => {
    mockedSeatsUsed.mockResolvedValue(4); // 1 seat free
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, {
      people: [person("Lead Booker", "lead@x.ch", ["t1"]), person("Guest Person", "guest@x.ch", ["t1"])],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/tickets? remaining/i);
  });

  it("succeeds when the order fits", async () => {
    mockedSeatsUsed.mockResolvedValue(4); // 1 seat free
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultFree] };
    const res = await publicPost(cfg, { people: [person("Lead Booker", "lead@x.ch", ["t1"])] });
    expect(res.status).toBe(200);
  });
});

describe("every violation in a multi-error order is reported at once (KD5/R5)", () => {
  it("a mononymous guest name AND an over-length guest name on two different rows both appear in one response", async () => {
    const publicEvent = { ...membersOnlyEvent, visibility: "public" };
    const adultPaid: TicketType = { id: "t1", title: "Asado", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
    const cfg: Cfg = { event: publicEvent, ticketTypes: [adultPaid] };
    const res = await publicPost(cfg, {
      people: [
        person("Lead Booker", "lead@x.ch", ["t1"]),
        person("Mono", "a@x.ch", ["t1"]), // mononymous
        person("x".repeat(121), "b@x.ch", ["t1"]), // over-length
      ],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.violations).toContainEqual(expect.objectContaining({ rule: "name_needs_first_and_last", personIndex: 1 }));
    expect(body.violations).toContainEqual(expect.objectContaining({ rule: "name_too_long", personIndex: 2 }));
    expect(cfg.capturedRpc).toBeUndefined();
  });
});

describe("offer redemption (U6)", () => {
  const offerEvent = { ...membersOnlyEvent, visibility: "public" };
  const OFFER_TOKEN = "offer-tok-abc";
  const ENTRY_EMAIL = "invitee@example.com";
  const entryQty2: WaitlistEntry = {
    id: "wl-1",
    email: ENTRY_EMAIL,
    quantity: 2,
    offer_token: OFFER_TOKEN,
    event_id: "evt-1",
  };

  const dinner: TicketType = { id: "t1", title: "Dinner", price_member: 80, price_non_member: 80, invite_price: null, counts_as_seat: true, archived_at: null };
  const lunch: TicketType = { id: "t2", title: "Lunch", price_member: 50, price_non_member: 50, invite_price: null, counts_as_seat: true, archived_at: null };
  const freeType: TicketType = { id: "t1", title: "Dinner", price_member: 0, price_non_member: 0, invite_price: null, counts_as_seat: true, archived_at: null };
  const merch: TicketType = { id: "t3", title: "Merch", price_member: 10, price_non_member: 10, invite_price: null, counts_as_seat: false, archived_at: null };

  // Person zero's name/email are always overridden server-side to the top-level
  // (post-pin) values, so a deliberately WRONG email here proves the pin holds.
  function offerPost(cfg: Cfg, body: Record<string, unknown>) {
    mockedAdmin.mockReturnValue(adminClient(cfg));
    return post({ name: "Buyer Person", email: "buyer-crafted@example.com", offer_token: OFFER_TOKEN, ...body });
  }

  // Solo buyer, one ticket of `ticketTypeId` — the common case for these tests.
  function soloBuyer(ticketTypeId: string) {
    return { people: [person("Buyer Person", "buyer-crafted@example.com", [ticketTypeId])] };
  }

  // --- Quantity lock (R6, an upper bound not exact equality) — added first per
  // the plan's Execution note: security-relevant and trivially satisfiable by an
  // implementation that only checks the client. ---
  describe("quantity lock", () => {
    it("covers AE2: an order totalling more than the entry's quantity is rejected and creates nothing", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { people: [person("Buyer", "b@x.ch", ["t1"]), ...distinctPeople(2, "t1")] });
      expect(res.status).toBe(400);
      expect(cfg.capturedRpc).toBeUndefined();
      expect(stripeCreate).not.toHaveBeenCalled();
    });

    it("covers AE9: an order totalling less than the entry's quantity is accepted", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, soloBuyer("t1"));
      expect(res.status).toBe(200);
    });

    it("an empty order against an offer for 2 returns 400", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, { people: [] });
      expect(res.status).toBe(400);
    });

    it("covers AE1: an offer for 2 x Dinner redeemed as 2 x Lunch is accepted and priced as Lunch", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner, lunch], waitlistEntry: entryQty2 };
      const res = await offerPost(cfg, {
        people: [person("Buyer Person", "buyer-crafted@example.com", ["t2"]), person("Guest Person", "guest@example.com", ["t2"])],
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
      const res = await offerPost(cfg, soloBuyer("t1"));
      expect(res.status).toBe(200);
      expect((cfg.capturedRpc?.args as unknown as { p_email: string }).p_email).toBe(ENTRY_EMAIL);
    });

    it("the Stripe session is created with the entry's email as customer_email", async () => {
      const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
      await offerPost(cfg, soloBuyer("t1"));
      expect(stripeCreate.mock.calls[0][0].customer_email).toBe(ENTRY_EMAIL);
    });
  });

  it("rejects a requested type with counts_as_seat false (KTD6)", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [merch], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, soloBuyer("t3"));
    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("rejects an order naming a ticket type the event does not have", async () => {
    // Named for what it actually exercises: the ticket-types mock ignores `.in(ids)`,
    // so requesting two ids while the fixture has one trips the route's own
    // `types.length < ids.length` count guard, not per-event scoping. Cross-event
    // scoping of the TOKEN is covered by the IDOR test below.
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, {
      people: [person("Buyer Person", "buyer-crafted@example.com", ["t1"]), person("X Guest", "x@x.ch", ["tX"])],
    });
    expect(res.status).toBe(400);
  });

  // IDOR: the token is unauthenticated and long-lived, so the ONLY thing stopping a
  // token minted for event A from redeeming against event B is the lookup's
  // `.eq("event_id", eventId)`. Delete that line and this test fails.
  it("refuses a token whose entry belongs to a different event", async () => {
    const cfg: Cfg = {
      event: offerEvent,
      ticketTypes: [dinner],
      waitlistEntry: { ...entryQty2, event_id: "evt-OTHER" },
    };
    const res = await offerPost(cfg, soloBuyer("t1"));

    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(cfg.capturedWaitlistFilters).toMatchObject({
      offer_token: OFFER_TOKEN,
      event_id: "evt-1",
    });
  });

  it("scopes the token lookup by both the token and the event", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    await offerPost(cfg, soloBuyer("t1"));
    expect(cfg.capturedWaitlistFilters).toMatchObject({
      offer_token: OFFER_TOKEN,
      event_id: "evt-1",
    });
  });

  it("rejects an unresolvable offer token", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: null };
    const res = await offerPost(cfg, soloBuyer("t1"));
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
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(400);
    expect(cfg.capturedRpc).toBeUndefined();
  });

  it("with one seat free and an offer for two, a solo order succeeds and a 2-person order returns 409 with the existing sold-out message", async () => {
    const cappedEvent = { ...offerEvent, seat_cap: 5 };
    mockedSeatsUsed.mockResolvedValue(4); // 1 seat free

    const okCfg: Cfg = { event: cappedEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const okRes = await offerPost(okCfg, soloBuyer("t1"));
    expect(okRes.status).toBe(200);

    const fullCfg: Cfg = { event: cappedEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const fullRes = await offerPost(fullCfg, {
      people: [person("Buyer Person", "buyer-crafted@example.com", ["t1"]), person("Guest Person", "guest@example.com", ["t1"])],
    });
    expect(fullRes.status).toBe(409);
    expect((await fullRes.json()).error).toMatch(/tickets? remaining/i);
  });

  it("a successful paid registration carries waitlist_entry_id", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(200);
    expect(cfg.capturedWaitlistLinkUpdate).toEqual({ waitlist_entry_id: "wl-1" });
  });

  it("a zero-total offer redemption creates a free registration carrying waitlist_entry_id and skips Stripe", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [freeType], waitlistEntry: entryQty2 };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(cfg.capturedWaitlistLinkUpdate).toEqual({ waitlist_entry_id: "wl-1" });
  });

  it("a failure writing waitlist_entry_id on the paid path returns 500 and never reaches Stripe", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(500);
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it("a failure writing waitlist_entry_id on the free path returns 500 and does not confirm the registration", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [freeType], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(500);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("a failure writing waitlist_entry_id on the free path deletes the orphaned free registration so the offer stays retryable", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [freeType], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    await offerPost(cfg, soloBuyer("t1"));
    expect(cfg.capturedRegistrationDelete).toBe("reg-1");
  });

  // When the rollback itself fails the free registration is stuck: it is terminal,
  // ticketless, and now reads as "already registered" everywhere. Retrying cannot
  // clear it, so the copy must not tell them to retry — it must hand them a
  // reference code and point them at a human.
  it("a failed rollback tells the buyer to contact the club with their reference, not to retry", async () => {
    const cfg: Cfg = {
      event: offerEvent,
      ticketTypes: [freeType],
      waitlistEntry: entryQty2,
      waitlistLinkUpdateError: true,
      registrationDeleteError: true,
    };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("contact the club");
    expect(body.error).not.toContain("Please try again");
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("a failure writing waitlist_entry_id on the paid path does NOT delete the registration (a pending row is already retryable)", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2, waitlistLinkUpdateError: true };
    const res = await offerPost(cfg, soloBuyer("t1"));
    expect(res.status).toBe(500);
    expect(cfg.capturedRegistrationDelete).toBeUndefined();
  });

  it("the Stripe success and cancel URLs carry the offer token", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner], waitlistEntry: entryQty2 };
    await offerPost(cfg, soloBuyer("t1"));
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain(`/public/offers/${OFFER_TOKEN}`);
    expect(args.cancel_url).toContain(`/public/offers/${OFFER_TOKEN}`);
  });

  it("R11/KTD7: an offer redemption on a members-only event cannot use the event's invite code to bypass active membership", async () => {
    const cfg: Cfg = { event: membersOnlyEvent, ticketTypes: [dinner], waitlistEntry: entryQty2, memberRow: null };
    const res = await offerPost(cfg, { code: INVITE, ...soloBuyer("t1") });
    expect(res.status).toBe(403);
  });

  it("a request with no offer_token behaves exactly as today (email not pinned, own event page URLs)", async () => {
    const cfg: Cfg = { event: offerEvent, ticketTypes: [dinner] };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await post({
      name: "Lead Booker",
      email: "lead@x.ch",
      people: [person("Lead Booker", "lead@x.ch", ["t1"])],
    });
    expect(res.status).toBe(200);
    expect((cfg.capturedRpc?.args as unknown as { p_email: string }).p_email).toBe("lead@x.ch");
    expect(cfg.capturedWaitlistLinkUpdate).toBeUndefined();
    const args = stripeCreate.mock.calls[0][0];
    expect(args.success_url).toContain("/public/events/evt-1");
  });
});
