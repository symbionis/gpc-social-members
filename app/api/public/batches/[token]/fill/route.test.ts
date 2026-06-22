import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/batches/[token]/fill/route";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

// The route delegates to fill_batch_ticket; the mock returns its result and records
// the args so we can assert the batch token (not a manage token) is forwarded.
let lastArgs: { fn?: string; args?: unknown } = {};
function adminClient(fill: Record<string, unknown> | null) {
  return {
    rpc: async (fn: string, args: unknown) => {
      lastArgs = { fn, args };
      return { data: fill, error: null };
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const TICKET = "11111111-2222-3333-4444-555555555555";

function post(body: unknown, token = "btok") {
  const req = new Request(`http://localhost/api/public/batches/${token}/fill`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastArgs = {};
  mockedAdmin.mockReturnValue(adminClient({ status: "claimed", attendee_id: TICKET, name: "Si" }));
});

describe("POST /api/public/batches/[token]/fill", () => {
  it("requires a ticketId", async () => {
    const res = await post({ name: "Si" });
    expect(res.status).toBe(400);
  });

  it("requires a name", async () => {
    const res = await post({ ticketId: TICKET });
    expect(res.status).toBe(400);
  });

  it("names a batch ticket via fill_batch_ticket scoped by the batch token", async () => {
    const res = await post({ ticketId: TICKET, name: "Si", email: "si@x.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ticketId: TICKET, name: "Si" });
    expect(lastArgs.fn).toBe("fill_batch_ticket");
    expect(lastArgs.args).toMatchObject({ p_batch_token: "btok", p_ticket_id: TICKET });
  });

  it("400s when the RPC rejects missing contact (invalid_input)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid_input", reason: "contact" }));
    const res = await post({ ticketId: TICKET, name: "Si" });
    expect(res.status).toBe(400);
  });

  it("404s a ticket not in this batch (not_found)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "not_found" }));
    const res = await post({ ticketId: TICKET, name: "Si", email: "a@x.com" });
    expect(res.status).toBe(404);
  });

  it("409s an inactive booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "inactive" }));
    const res = await post({ ticketId: TICKET, name: "Si", email: "a@x.com" });
    expect(res.status).toBe(409);
  });

  it("404s an unknown/invalid batch token (invalid)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid" }));
    const res = await post({ ticketId: TICKET, name: "Si", email: "a@x.com" });
    expect(res.status).toBe(404);
  });
});
