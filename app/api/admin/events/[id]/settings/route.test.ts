import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { PATCH } from "@/app/api/admin/events/[id]/settings/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(admins: { id: string; role: string }[], updateError: unknown = null) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "update"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve(table === "events" ? { data: null, error: updateError } : { data: admins, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function patch(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/admin/events/evt-1/settings", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedCreateAdminClient.mockReturnValue(adminClient(superAdmin));
});

describe("PATCH /api/admin/events/[id]/settings", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    const res = await patch({ strict_checkin: true });
    expect(res.status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient([]));
    const res = await patch({ strict_checkin: true });
    expect(res.status).toBe(403);
  });

  it("400s a non-boolean strict_checkin", async () => {
    const res = await patch({ strict_checkin: "yes" });
    expect(res.status).toBe(400);
  });

  it("400s invalid JSON", async () => {
    const res = await patch("not json");
    expect(res.status).toBe(400);
  });

  it("persists a valid boolean for an admin", async () => {
    const res = await patch({ strict_checkin: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true });
  });

  it("500s when the update fails", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient(superAdmin, { message: "db error" }));
    const res = await patch({ strict_checkin: false });
    expect(res.status).toBe(500);
  });
});
