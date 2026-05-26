import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/registration", () => ({
  generateReferenceCode: vi.fn(() => "EV-TEST1234"),
  findActiveMemberByEmail: vi.fn(),
  hasExistingRegistration: vi.fn(),
}));
vi.mock("@/lib/email/event-waitlist", () => ({ sendWaitlistConfirmation: vi.fn() }));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/waitlist/convert/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findActiveMemberByEmail, hasExistingRegistration } from "@/lib/events/registration";
import { sendWaitlistConfirmation } from "@/lib/email/event-waitlist";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedHasExisting = vi.mocked(hasExistingRegistration);
const mockedFindMember = vi.mocked(findActiveMemberByEmail);
const mockedSendEmail = vi.mocked(sendWaitlistConfirmation);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

type RpcArgs = {
  p_status: string;
  p_is_member: boolean;
  p_member_id: string | null;
  p_converted_by: string | null;
  p_items: { ticket_type_id: string; title_snapshot: string; quantity: number; unit_amount_chf: number; line_total_chf: number }[];
};
let capturedRpc: { name: string; args: RpcArgs } | null = null;

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(opts: {
  admins?: { id: string; role: string }[];
  waitlistEntry?: unknown;
  ticketType?: { id: string; title: string } | null;
  rpcResult?: string | null;
  rpcError?: { code?: string } | null;
  deleteErr?: unknown;
}) {
  return {
    from: (table: string) => {
      let isDelete = false;
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "ilike", "order", "is"]) c[m] = () => c;
      c.delete = () => {
        isDelete = true;
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_waitlist") {
          return { data: opts.waitlistEntry ?? null, error: null };
        }
        if (table === "event_ticket_types") {
          return { data: opts.ticketType ?? { id: "tt-1", title: "Standard" }, error: null };
        }
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: opts.admins ?? [], error: null });
        if (isDelete) return resolve({ data: null, error: opts.deleteErr ?? null });
        return resolve({ data: null, error: null });
      };
      return c;
    },
    rpc: (name: string, args: RpcArgs) => {
      capturedRpc = { name, args };
      return Promise.resolve({
        data: opts.rpcError ? null : opts.rpcResult ?? "reg-new",
        error: opts.rpcError ?? null,
      });
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/admin/events/evt-1/waitlist/convert", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "admin-1", role: "super_admin" }];
const entry = { id: "wl-1", name: "Astrid Ferrari", email: "Astrid@x.ch", ticket_type_id: "tt-1", quantity: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  capturedRpc = null;
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.co" }));
  mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin, waitlistEntry: entry }));
  mockedHasExisting.mockResolvedValue(false);
  mockedFindMember.mockResolvedValue(null);
  mockedSendEmail.mockResolvedValue({ success: true });
  mockedSeatsUsed.mockResolvedValue(501);
});

describe("convert — auth & validation", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post({ waitlistId: "wl-1" })).status).toBe(401);
  });
  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [], waitlistEntry: entry }));
    expect((await post({ waitlistId: "wl-1" })).status).toBe(403);
  });
  it("400s a missing waitlistId", async () => {
    expect((await post({})).status).toBe(400);
  });
  it("404s when the entry is absent / belongs to another event", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin, waitlistEntry: null }));
    expect((await post({ waitlistId: "wl-x" })).status).toBe(404);
  });
});

describe("convert — conversion (no admin quantity input; uses the entry)", () => {
  it("503s when a lookup throws", async () => {
    mockedHasExisting.mockRejectedValue(new Error("db down"));
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(503);
    expect(capturedRpc).toBeNull();
  });

  it("409s when the email already has a registration", async () => {
    mockedHasExisting.mockResolvedValue(true);
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(409);
    expect(capturedRpc).toBeNull();
  });

  it("creates a free comped registration + line item from the entry's type & quantity", async () => {
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, reference_code: "EV-TEST1234", email_sent: true, seats_used: 501 });
    expect(capturedRpc?.name).toBe("create_event_registration");
    expect(capturedRpc?.args).toMatchObject({ p_status: "free", p_converted_by: "admin-1", p_is_member: false });
    expect(capturedRpc?.args.p_items).toEqual([
      { ticket_type_id: "tt-1", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 0, line_total_chf: 0 },
    ]);
    expect(mockedSendEmail).toHaveBeenCalledWith("reg-new");
  });

  it("sets is_member + member_id when the email matches an active member", async () => {
    mockedFindMember.mockResolvedValue({ id: "mem-9" });
    await post({ waitlistId: "wl-1" });
    expect(capturedRpc?.args).toMatchObject({ p_is_member: true, p_member_id: "mem-9" });
  });

  it("falls back to quantity 1 for a legacy entry with null quantity", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, waitlistEntry: { ...entry, quantity: null } })
    );
    await post({ waitlistId: "wl-1" });
    expect(capturedRpc?.args.p_items[0].quantity).toBe(1);
  });

  it("returns 409 on a 23505 unique-violation race", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, waitlistEntry: entry, rpcError: { code: "23505" } })
    );
    expect((await post({ waitlistId: "wl-1" })).status).toBe(409);
  });

  it("still succeeds (200) when the confirmation email fails", async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: "no template" });
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).email_sent).toBe(false);
  });

  it("still succeeds (200) when the waitlist delete fails after insert", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, waitlistEntry: entry, deleteErr: { message: "delete failed" } })
    );
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).reference_code).toBe("EV-TEST1234");
  });

  it("returns seats_used:null (still 200) when the seat-count read fails", async () => {
    mockedSeatsUsed.mockRejectedValue(new Error("rpc down"));
    const res = await post({ waitlistId: "wl-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).seats_used).toBeNull();
  });
});
