import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/manage-token/route";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

// The route is a thin wrapper over rotate_ticket_manage_token: it forwards the path token,
// returns the RPC's new token on ok, and 404s otherwise. Household-wide rotation itself is
// proven at the DB level (migration verification); here we pin the route's contract.
function adminClient(rpc: {
  data?: Record<string, unknown> | null;
  error?: unknown;
  spy?: (args: unknown) => void;
}) {
  return {
    rpc: async (_name: string, args: unknown) => {
      rpc.spy?.(args);
      return { data: rpc.data ?? null, error: rpc.error ?? null };
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, token = "old-token") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/manage-token`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({ data: { status: "ok", manage_token: "new-token" } }));
});

describe("POST /api/public/bookings/[token]/manage-token", () => {
  it("rotates and returns the caller's new manage token", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, manageToken: "new-token" });
  });

  it("passes the path token to the RPC and ignores any client-supplied token", async () => {
    const spy = vi.fn();
    mockedAdmin.mockReturnValue(
      adminClient({ data: { status: "ok", manage_token: "new-token" }, spy })
    );
    await post({ manageToken: "attacker-supplied", token: "attacker-supplied" }, "real-path-token");
    expect(spy).toHaveBeenCalledWith({ p_manage_token: "real-path-token" });
  });

  it("404s an unknown token", async () => {
    mockedAdmin.mockReturnValue(adminClient({ data: { status: "not_found" } }));
    const res = await post({});
    expect(res.status).toBe(404);
  });

  it("404s an empty/invalid token", async () => {
    mockedAdmin.mockReturnValue(adminClient({ data: { status: "invalid" } }));
    const res = await post({});
    expect(res.status).toBe(404);
  });

  it("500s on an RPC error", async () => {
    mockedAdmin.mockReturnValue(adminClient({ error: { message: "boom" } }));
    const res = await post({});
    expect(res.status).toBe(500);
  });
});
