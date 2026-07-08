import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/fill/route";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

// The route delegates to fill_ticket; the mock returns its result. When an email is
// missing the route first looks up the registration (by manage_token) and the ticket
// (for is_child) before the RPC — the mock serves those from `reg` / `ticket`.
function adminClient(
  fill: Record<string, unknown> | null,
  opts: { reg?: Record<string, unknown> | null; ticket?: Record<string, unknown> | null } = {}
) {
  const { reg = { id: "reg1" }, ticket = { is_child: false } } = opts;
  const table = (row: Record<string, unknown> | null) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return builder;
  };
  return {
    from: (name: string) => table(name === "tickets" ? ticket : reg),
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

  it("400s an adult ticket named with no email (QR can't be delivered)", async () => {
    // Default mock ticket is an adult (is_child: false); phone-only must be rejected.
    const res = await post({ ticketId: TICKET, name: "Ann", phone: "+41791112233" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("email") });
  });

  it("allows a child ticket to be named with no email (name-only)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ status: "claimed", attendee_id: TICKET, name: "Kid" }, { ticket: { is_child: true } })
    );
    const res = await post({ ticketId: TICKET, name: "Kid" });
    expect(res.status).toBe(200);
  });

  it("404s when the ticket isn't in this booking (email-less path)", async () => {
    mockedAdmin.mockReturnValue(adminClient(null, { ticket: null }));
    const res = await post({ ticketId: TICKET, name: "Ann" });
    expect(res.status).toBe(404);
  });

  it("400s when the RPC rejects missing contact (invalid_input)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid_input", reason: "contact" }));
    const res = await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
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
