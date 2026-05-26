import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { PATCH } from "@/app/api/admin/events/[id]/registrations/[registrationId]/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

interface AdminClientOpts {
  admins?: { id: string; role: string }[];
  registration?: { id: string; status: string } | null;
  updateError?: unknown;
  seatsUsed?: number;
}

// The route touches admin_users (select), event_registrations (select →
// maybeSingle, then update), and the seats_used RPC. Each chain is a thenable
// resolving to the right payload for its table.
function adminClient({
  admins = [{ id: "a1", role: "super_admin" }],
  registration = { id: "reg-1", status: "paid" },
  updateError = null,
  seatsUsed = 7,
}: AdminClientOpts = {}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "update"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: registration, error: null });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: admins, error: null });
        // event_registrations update path
        return resolve({ data: null, error: updateError });
      };
      return c;
    },
    rpc: async () => ({ data: seatsUsed, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

function patch(
  body: unknown,
  { id = "evt-1", registrationId = "reg-1" } = {}
) {
  const req = new Request(
    `http://localhost/api/admin/events/${id}/registrations/${registrationId}`,
    {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return PATCH(req as never, {
    params: Promise.resolve({ id, registrationId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedCreateAdminClient.mockReturnValue(adminClient());
});

describe("PATCH /api/admin/events/[id]/registrations/[registrationId]", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    const res = await patch({ quantity: 3 });
    expect(res.status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [] }));
    const res = await patch({ quantity: 3 });
    expect(res.status).toBe(403);
  });

  it("400s invalid JSON", async () => {
    const res = await patch("not json");
    expect(res.status).toBe(400);
  });

  it("400s a non-integer or out-of-range quantity", async () => {
    expect((await patch({ quantity: 0 })).status).toBe(400);
    expect((await patch({ quantity: 11 })).status).toBe(400);
    expect((await patch({ quantity: 2.5 })).status).toBe(400);
    expect((await patch({ quantity: "abc" })).status).toBe(400);
  });

  it("404s when the registration does not belong to the event", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ registration: null }));
    const res = await patch({ quantity: 3 });
    expect(res.status).toBe(404);
  });

  it("409s a non-confirmed (pending) registration", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ registration: { id: "reg-1", status: "pending" } })
    );
    const res = await patch({ quantity: 3 });
    expect(res.status).toBe(409);
  });

  it("updates the quantity and returns the post-edit seat usage", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ seatsUsed: 12 }));
    const res = await patch({ quantity: 4 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, quantity: 4, seats_used: 12 });
  });

  it("500s when the update fails", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ updateError: { message: "db error" } })
    );
    const res = await patch({ quantity: 3 });
    expect(res.status).toBe(500);
  });
});
