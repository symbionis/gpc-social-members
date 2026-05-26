import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/admin/events/update/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type Capture = { updated?: Record<string, unknown> };

function adminClient(admins: { id: string; role: string }[], capture: Capture) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.limit = () => c;
      c.eq = () => c;
      c.update = (payload: Record<string, unknown>) => {
        capture.updated = payload;
        return c;
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve(
          table === "events" ? { data: null, error: null } : { data: admins, error: null }
        );
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown) {
  const r = new Request("http://localhost/api/admin/events/update", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(r as never);
}

let capture: Capture;

beforeEach(() => {
  vi.clearAllMocks();
  capture = {};
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedAdmin.mockReturnValue(adminClient([{ id: "a1", role: "super_admin" }], capture));
});

describe("single-writer: bulk update never touches invite fields", () => {
  it("editing a members-only event does not write invite_code or invite_price", async () => {
    const res = await post({
      event_id: "evt-1",
      title: "Renamed Gala",
      visibility: "members_only",
      registration_enabled: false,
      start_date: "2026-07-01",
    });
    expect(res.status).toBe(200);
    expect(capture.updated).toBeDefined();
    expect(capture.updated).not.toHaveProperty("invite_code");
    expect(capture.updated).not.toHaveProperty("invite_price");
  });
});
