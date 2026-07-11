import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST, DELETE } from "@/app/api/admin/events/[id]/guest-list/[regId]/guests/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

type RpcArgs = Record<string, unknown>;
let rpcCalls: { name: string; args: RpcArgs }[] = [];
const capturedRpc = () => rpcCalls[0] ?? null;

// Every .eq() the route applies, per table — this is how the IDOR guard is asserted:
// the ticket lookup must be scoped to id + registration_id + event_id.
let filters: Record<string, Record<string, unknown>> = {};

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

// The rows the scoped lookups are meant to find: the comp registration lives on evt-1, and
// tk-1 is a COMP ticket on it. A paid top-up ticket on the same registration is is_comp:false.
const REGISTRATION: Record<string, unknown> = {
  id: "reg-1",
  event_id: "evt-1",
  is_guest_list: true,
};
const TICKET: Record<string, unknown> = {
  id: "tk-1",
  registration_id: "reg-1",
  event_id: "evt-1",
  is_comp: true,
};

/**
 * The stub APPLIES the route's own .eq() filters to the fixture row, so a lookup that is not
 * scoped to the path event (or not scoped to comp tickets) genuinely finds the row it should
 * not — the guards are proven, not simulated.
 */
function matchesFilters(row: unknown, applied: Record<string, unknown>): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return Object.entries(applied).every(([col, val]) => r[col] === val);
}

function adminClient(opts: {
  admins?: { id: string; role: string }[];
  registration?: unknown;
  ticket?: unknown;
  activeTypes?: { id: string }[];
  rpcResult?: unknown;
  rpcError?: { code?: string; message?: string } | null;
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "in", "limit", "order", "is", "update", "delete"]) c[m] = () => c;
      c.eq = (col: string, val: unknown) => {
        filters[table] = { ...(filters[table] ?? {}), [col]: val };
        return c;
      };
      c.maybeSingle = async () => {
        const applied = filters[table] ?? {};
        if (table === "event_registrations") {
          const row = "registration" in opts ? opts.registration : REGISTRATION;
          return { data: matchesFilters(row, applied) ? row : null, error: null };
        }
        if (table === "tickets") {
          const row = "ticket" in opts ? opts.ticket : TICKET;
          return { data: matchesFilters(row, applied) ? row : null, error: null };
        }
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: opts.admins ?? [], error: null });
        if (table === "event_ticket_types") {
          return resolve({ data: opts.activeTypes ?? [{ id: "tt-1" }, { id: "tt-2" }], error: null });
        }
        return resolve({ data: null, error: null });
      };
      return c;
    },
    rpc: (name: string, args: RpcArgs) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: opts.rpcError ? null : opts.rpcResult ?? null,
        error: opts.rpcError ?? null,
      });
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function call(
  handler: typeof POST | typeof DELETE,
  method: string,
  body: unknown,
  { eventId = "evt-1", regId = "reg-1" } = {}
) {
  const req = new Request("http://localhost/api/admin/events/evt-1/guest-list/reg-1/guests", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return handler(req as never, { params: Promise.resolve({ id: eventId, regId }) });
}

const post = (body: unknown, opts?: { eventId?: string; regId?: string }) =>
  call(POST, "POST", body, opts);
const del = (body: unknown, opts?: { eventId?: string; regId?: string }) =>
  call(DELETE, "DELETE", body, opts);

const superAdmin = [{ id: "admin-1", role: "super_admin" }];
const addBody = {
  idempotencyKey: "idem-abc",
  guests: [
    { name: "Guest Three", ticketTypeId: "tt-1" },
    { name: "Guest Four", ticketTypeId: "tt-2" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls = [];
  filters = {};
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.co" }));
  mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin, rpcResult: 2 }));
  mockedSeatsUsed.mockResolvedValue(42);
});

describe("guest-list add — auth", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post(addBody)).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [] }));
    expect((await post(addBody)).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("guest-list remove — auth", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await del({ ticketId: "tk-1" })).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [] }));
    expect((await del({ ticketId: "tk-1" })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("guest-list add — validation", () => {
  it("400s a missing idempotencyKey (the replay guard, KTD2)", async () => {
    const res = await post({ guests: addBody.guests });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/idempotency/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s a guest with no name", async () => {
    const res = await post({ idempotencyKey: "idem-abc", guests: [{ name: "", ticketTypeId: "tt-1" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s a guest with no ticket type", async () => {
    const res = await post({ idempotencyKey: "idem-abc", guests: [{ name: "Guest Three" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ticket type/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s an empty guest list", async () => {
    const res = await post({ idempotencyKey: "idem-abc", guests: [] });
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("guest-list add — write", () => {
  it("calls add_comp_guests with the client's idempotency key and returns the count added", async () => {
    const res = await post(addBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, added: 2, seats_used: 42 });

    expect(capturedRpc()?.name).toBe("add_comp_guests");
    expect(capturedRpc()?.args).toMatchObject({
      p_registration_id: "reg-1",
      p_idempotency_key: "idem-abc",
    });
    expect(capturedRpc()?.args.p_guests).toEqual([
      { name: "Guest Three", ticket_type_id: "tt-1", email: null, phone_e164: null },
      { name: "Guest Four", ticket_type_id: "tt-2", email: null, phone_e164: null },
    ]);
  });

  it("400s and names the offending type when a ticket type is from another event or archived", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        activeTypes: [{ id: "tt-1" }],
        rpcError: {
          code: "P0001",
          message: "add_comp_guests: every ticket_type_id must be an active ticket type of event evt-1",
        },
      })
    );
    const res = await post({
      idempotencyKey: "idem-abc",
      guests: [{ name: "Guest Three", ticketTypeId: "tt-archived" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tt-archived");
  });

  it("scopes the registration to the path event and to a guest list BEFORE the RPC (IDOR guard)", async () => {
    const res = await post(addBody);
    expect(res.status).toBe(200);
    expect(filters.event_registrations).toMatchObject({
      id: "reg-1",
      event_id: "evt-1",
      is_guest_list: true,
    });
  });

  it("404s (and calls no RPC) when the regId is a registration on ANOTHER event", async () => {
    // add_comp_guests resolves ticket types against the REGISTRATION's event, so an
    // unscoped regId would write guests onto that other event's list while this route
    // reported the path event's seat count.
    const res = await post(addBody, { eventId: "evt-other" });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("404s (and calls no RPC) when the registration is not a guest list", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, registration: null })
    );
    const res = await post(addBody);
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s when the registration is not a comp guest list (the RPC refuses)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        rpcError: {
          code: "P0001",
          message: "add_comp_guests: registration reg-1 is not a comp guest list",
        },
      })
    );
    const res = await post(addBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a comp guest list/i);
  });

  it("returns seats_used:null (still 200) when the seat count fails after the write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedSeatsUsed.mockRejectedValue(new Error("rpc down"));
    const res = await post(addBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, added: 2, seats_used: null });
  });
});

describe("guest-list remove", () => {
  it("400s a missing ticketId", async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it("scopes the ticket lookup to the ticket, the registration AND the event (IDOR guard)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcResult: { status: "ok" } })
    );
    const res = await del({ ticketId: "tk-1" });
    expect(res.status).toBe(200);
    expect(filters.tickets).toMatchObject({
      id: "tk-1",
      registration_id: "reg-1",
      event_id: "evt-1",
      is_comp: true,
    });
    expect(filters.event_registrations).toMatchObject({
      id: "reg-1",
      event_id: "evt-1",
      is_guest_list: true,
    });
  });

  it("404s (and calls no RPC) on a PAID top-up ticket sitting on the comp registration", async () => {
    // The comp registration has a manage_token and the public top-up route accepts
    // status 'free', so the lead can buy real tickets onto it. Those are claimed rows with
    // is_comp = false — tombstoning one would destroy a ticket the customer paid for.
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: {
          id: "tk-paid",
          registration_id: "reg-1",
          event_id: "evt-1",
          is_comp: false,
        },
      })
    );
    const res = await del({ ticketId: "tk-paid" });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("404s (and calls no RPC) when the regId is a registration on ANOTHER event", async () => {
    const res = await del({ ticketId: "tk-1" }, { eventId: "evt-other" });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("404s (and calls no RPC) when the ticket belongs to another registration in the same event", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, ticket: null }) // the scoped lookup finds nothing
    );
    const res = await del({ ticketId: "tk-other-party" });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("404s (and calls no RPC) when the registration is not a guest list", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, registration: null })
    );
    const res = await del({ ticketId: "tk-1" });
    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("removes a guest: calls remove_comp_guest and returns 200", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcResult: { status: "ok", already: false } })
    );
    const res = await del({ ticketId: "tk-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, seats_used: 42 });
    expect(capturedRpc()?.name).toBe("remove_comp_guest");
    expect(capturedRpc()?.args).toMatchObject({ p_registration_id: "reg-1", p_ticket_id: "tk-1" });
  });

  it("409s a checked-in guest", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcResult: { status: "checked_in" } })
    );
    const res = await del({ ticketId: "tk-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/checked in/i);
  });

  it("400s removing the lead", async () => {
    // The lead's ticket is itself a comp ticket, so it passes the lookup — the RPC is what
    // refuses it (the lead IS the registration).
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        ticket: { ...TICKET, id: "tk-lead" },
        rpcResult: { status: "is_lead" },
      })
    );
    const res = await del({ ticketId: "tk-lead" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/lead/i);
  });

  it("404s when the RPC itself reports not_found", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcResult: { status: "not_found" } })
    );
    expect((await del({ ticketId: "tk-1" })).status).toBe(404);
  });

  it("500s an unexpected RPC failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcError: { code: "08006", message: "connection reset" } })
    );
    expect((await del({ ticketId: "tk-1" })).status).toBe(500);
  });

  it("returns seats_used:null (still 200) when the seat count fails after the removal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcResult: { status: "ok" } })
    );
    mockedSeatsUsed.mockRejectedValue(new Error("rpc down"));
    const res = await del({ ticketId: "tk-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).seats_used).toBeNull();
  });
});
