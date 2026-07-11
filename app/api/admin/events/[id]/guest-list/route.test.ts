import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/registration", () => ({
  generateReferenceCode: vi.fn(() => "EV-TEST1234"),
}));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/guest-list/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

type RpcArgs = {
  p_event_id: string;
  p_lead: { name: string; email: string; ticket_type_id: string; phone_e164: string | null };
  p_guests: { name: string; ticket_type_id: string; email: string | null; phone_e164: string | null }[];
  p_reference_code: string;
  p_converted_by: string;
};
let rpcCalls: { name: string; args: RpcArgs }[] = [];
const capturedRpc = () => rpcCalls[0] ?? null;

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(opts: {
  admins?: { id: string; role: string }[];
  activeTypes?: { id: string }[];
  rpcResult?: string | null;
  rpcError?: { code?: string; message?: string } | null;
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "order", "is", "update", "delete"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: null, error: null });
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
        data: opts.rpcError ? null : opts.rpcResult ?? "reg-new",
        error: opts.rpcError ?? null,
      });
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/admin/events/evt-1/guest-list", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "admin-1", role: "super_admin" }];
const validBody = {
  lead: { name: "Astrid Ferrari", email: "Astrid@X.ch", ticketTypeId: "tt-1" },
  guests: [
    { name: "Guest One", ticketTypeId: "tt-1" },
    { name: "Guest Two", ticketTypeId: "tt-2", email: "two@x.ch" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls = [];
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.co" }));
  mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin }));
  mockedSeatsUsed.mockResolvedValue(501);
});

describe("guest-list create — auth", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post(validBody)).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [] }));
    expect((await post(validBody)).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it("403s an admin whose role is not allowed", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: [{ id: "admin-2", role: "read_only" }] })
    );
    expect((await post(validBody)).status).toBe(403);
  });
});

describe("guest-list create — validation", () => {
  it("400s invalid JSON", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("400s a lead with no email", async () => {
    const res = await post({ lead: { name: "A", ticketTypeId: "tt-1" }, guests: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/email/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s a lead with no ticket type", async () => {
    const res = await post({ lead: { name: "A", email: "a@x.ch" }, guests: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ticket type/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s a guest with no name", async () => {
    const res = await post({
      lead: { name: "A", email: "a@x.ch", ticketTypeId: "tt-1" },
      guests: [{ name: "  ", ticketTypeId: "tt-1" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it("400s a guest with no ticket type", async () => {
    const res = await post({
      lead: { name: "A", email: "a@x.ch", ticketTypeId: "tt-1" },
      guests: [{ name: "Guest One" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ticket type/i);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("guest-list create — write", () => {
  it("calls create_comp_guest_list with the lead, the guests and p_converted_by, and returns the reference code", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      registration_id: "reg-new",
      reference_code: "EV-TEST1234",
      seats_used: 501,
    });

    expect(capturedRpc()?.name).toBe("create_comp_guest_list");
    expect(capturedRpc()?.args).toMatchObject({
      p_event_id: "evt-1",
      p_reference_code: "EV-TEST1234",
      p_converted_by: "admin-1",
    });
    expect(capturedRpc()?.args.p_lead).toEqual({
      name: "Astrid Ferrari",
      email: "astrid@x.ch",
      ticket_type_id: "tt-1",
      phone_e164: null,
    });
    expect(capturedRpc()?.args.p_guests).toEqual([
      { name: "Guest One", ticket_type_id: "tt-1", email: null, phone_e164: null },
      { name: "Guest Two", ticket_type_id: "tt-2", email: "two@x.ch", phone_e164: null },
    ]);
  });

  it("accepts a lead with no guests", async () => {
    const res = await post({ lead: validBody.lead });
    expect(res.status).toBe(200);
    expect(capturedRpc()?.args.p_guests).toEqual([]);
  });

  it("succeeds even when the list takes the event past its seat cap (no cap gate)", async () => {
    // 60 comp guests on a 40-seat event: the route must not read a cap, must not
    // compare against one, and must not reject (KTD6 / R11).
    mockedSeatsUsed.mockResolvedValue(100);
    const guests = Array.from({ length: 60 }, (_, i) => ({ name: `Guest ${i}`, ticketTypeId: "tt-1" }));
    const res = await post({ lead: validBody.lead, guests });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, seats_used: 100 });
    expect(capturedRpc()?.args.p_guests).toHaveLength(60);
  });

  it("409s a duplicate lead email (23505)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcError: { code: "23505", message: "duplicate key" } })
    );
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already registered/i);
  });

  it("400s and names the offending type when a ticket type belongs to another event", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        activeTypes: [{ id: "tt-1" }], // tt-foreign is not an active type of this event
        rpcError: {
          code: "P0001",
          message:
            "create_comp_guest_list: every ticket_type_id must be an active ticket type of event evt-1",
        },
      })
    );
    const res = await post({
      lead: validBody.lead,
      guests: [{ name: "Guest One", ticketTypeId: "tt-foreign" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tt-foreign");
  });

  it("400s when a ticket type is archived", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        activeTypes: [{ id: "tt-2" }], // tt-1 has been archived
        rpcError: {
          code: "P0001",
          message:
            "create_comp_guest_list: every ticket_type_id must be an active ticket type of event evt-1",
        },
      })
    );
    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tt-1");
  });

  it("400s with the server's message when the event has no active ticket types", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({
        admins: superAdmin,
        activeTypes: [],
        rpcError: {
          code: "P0001",
          message: "create_comp_guest_list: event evt-1 has no active ticket types",
        },
      })
    );
    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no active ticket types/i);
  });

  it("500s an unexpected RPC failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, rpcError: { code: "08006", message: "connection reset" } })
    );
    expect((await post(validBody)).status).toBe(500);
  });

  it("returns seats_used:null (still 200) when the seat count fails after the write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedSeatsUsed.mockRejectedValue(new Error("rpc down"));
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seats_used).toBeNull();
    expect(body.reference_code).toBe("EV-TEST1234");
  });
});
