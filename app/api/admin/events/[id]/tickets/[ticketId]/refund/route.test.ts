import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/tickets/[ticketId]/refund/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const TICKET = "33333333-3333-3333-3333-333333333333";

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

let lastUpdate: Record<string, unknown> | null = null;

// admin_users → role gate; tickets → the guarded UPDATE result, then a fallback SELECT of the
// current status when the update matched nothing.
function adminClient(opts: {
  admins: { id: string; role: string }[];
  updated?: { id: string } | null;
  current?: { cancellation_status: string | null } | null;
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
        if (c._upd) return { data: opts.updated ?? null, error: null };
        if (table === "tickets") return { data: opts.current ?? null, error: null };
        return { data: null, error: null };
      };
      if (table === "admin_users") {
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.admins, error: null });
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
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("POST ticket refund (U14)", () => {
  it("advances a requested ticket to refunded", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, updated: { id: TICKET } }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(lastUpdate).toMatchObject({ cancellation_status: "refunded" });
    expect(lastUpdate?.cancellation_refunded_at).toBeTruthy();
  });

  it("rejects a non-admin with 403", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [] }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(lastUpdate).toBeNull();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("400s an invalid ticket id", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    const res = await post("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("is idempotent — already refunded is a no-op success", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, updated: null, current: { cancellation_status: "refunded" } })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyRefunded: true });
  });

  it("409s a ticket that was never cancelled", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, updated: null, current: { cancellation_status: null } })
    );
    const res = await post();
    expect(res.status).toBe(409);
  });

  it("404s a missing ticket", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, updated: null, current: null }));
    const res = await post();
    expect(res.status).toBe(404);
  });
});
