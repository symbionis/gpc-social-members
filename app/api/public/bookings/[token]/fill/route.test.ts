import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/fill/route";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

// The route delegates to fill_ticket; the mock returns its result.
function adminClient(fill: Record<string, unknown> | null) {
  return {
    rpc: async (_fn: string, _args: unknown) => ({ data: fill, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

const TICKET = "11111111-2222-3333-4444-555555555555";

function post(body: unknown, token = "mtok") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/fill`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({ status: "claimed", attendee_id: TICKET, name: "Ann" }));
});

describe("POST /api/public/bookings/[token]/fill", () => {
  it("requires a ticketId", async () => {
    const res = await post({ name: "Ann" });
    expect(res.status).toBe(400);
  });

  it("requires a name", async () => {
    const res = await post({ ticketId: TICKET });
    expect(res.status).toBe(400);
  });

  it("names a ticket (fill_ticket → claimed)", async () => {
    const res = await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ticketId: TICKET, name: "Ann" });
  });

  it("400s when the RPC rejects missing contact (invalid_input)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid_input", reason: "contact" }));
    const res = await post({ ticketId: TICKET, name: "Ann" });
    expect(res.status).toBe(400);
  });

  it("404s a ticket not in this booking (not_found)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "not_found" }));
    const res = await post({ ticketId: TICKET, name: "Ann", email: "a@x.com" });
    expect(res.status).toBe(404);
  });

  it("404s an unknown/invalid manage_token (invalid)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid" }));
    const res = await post({ ticketId: TICKET, name: "Ann", email: "a@x.com" });
    expect(res.status).toBe(404);
  });
});
