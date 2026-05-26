import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// Real generateInviteCode — we assert on its output shape.

import { POST } from "@/app/api/admin/events/[id]/invite-code/route";
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

function adminClient(
  admins: { id: string; role: string }[],
  capture: Capture,
  updateError: unknown = null
) {
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
          table === "events"
            ? { data: null, error: updateError }
            : { data: admins, error: null }
        );
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

function req(method: string, body?: unknown, eventId = "evt-1") {
  const r = new Request("http://localhost/api/admin/events/evt-1/invite-code", {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const params = { params: Promise.resolve({ id: eventId }) };
  void method;
  return POST(r as never, params);
}

let capture: Capture;

beforeEach(() => {
  vi.clearAllMocks();
  capture = {};
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedAdmin.mockReturnValue(adminClient(superAdmin, capture));
});

describe("POST (regenerate invite code)", () => {
  it("writes a fresh 16-char code and returns it", async () => {
    const res = await req("POST");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.invite_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    // writes ONLY invite_code
    expect(Object.keys(capture.updated ?? {})).toEqual(["invite_code"]);
  });

  it("produces a different code on a second call (regenerate = revoke)", async () => {
    const first = await (await req("POST")).json();
    const second = await (await req("POST")).json();
    expect(first.invite_code).not.toBe(second.invite_code);
  });

  it("401s an unauthenticated caller, no write", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    const res = await req("POST");
    expect(res.status).toBe(401);
    expect(capture.updated).toBeUndefined();
  });

  it("403s a signed-in non-admin, no write", async () => {
    mockedAdmin.mockReturnValue(adminClient([], capture));
    const res = await req("POST");
    expect(res.status).toBe(403);
    expect(capture.updated).toBeUndefined();
  });
});

// Guest pricing moved to the per-type ticket-types route (U8); the invite-code
// route no longer exposes a PATCH for invite_price.
