import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/ticket-forward", () => ({ sendTicketForwardEmail: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/forward/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTicketForwardEmail } from "@/lib/email/ticket-forward";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendTicketForwardEmail);

// rpc → forward_ticket_batch result; from → reg/event lookups for the email.
function adminClient(fwd: Record<string, unknown> | null) {
  return {
    rpc: async () => ({ data: fwd, error: null }),
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () =>
        table === "event_registrations"
          ? { data: { name: "Lead", event_id: "evt" }, error: null }
          : { data: { title: "Asado", start_date: "2026-07-01" }, error: null };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const T1 = "11111111-2222-3333-4444-555555555555";
const T2 = "66666666-7777-8888-9999-aaaaaaaaaaaa";

function post(body: unknown, token = "mtok") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/forward`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true } as never);
  mockedAdmin.mockReturnValue(adminClient({ status: "ok", batch_token: "btok", count: 2 }));
});

describe("POST /api/public/bookings/[token]/forward", () => {
  it("requires a valid recipient email", async () => {
    const res = await post({ ticketIds: [T1], email: "nope" });
    expect(res.status).toBe(400);
  });

  it("requires at least one ticket", async () => {
    const res = await post({ ticketIds: [], email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("forwards a batch and emails the delegate", async () => {
    const res = await post({ ticketIds: [T1, T2], email: "simon@x.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 2 });
    expect(mockedSend).toHaveBeenCalledOnce();
    expect(mockedSend.mock.calls[0][0]).toMatchObject({ to: "simon@x.com", ticketCount: 2 });
  });

  it("409s when no tickets are eligible (status none)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "none", count: 0 }));
    const res = await post({ ticketIds: [T1], email: "a@b.com" });
    expect(res.status).toBe(409);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("404s an invalid manage_token", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "invalid" }));
    const res = await post({ ticketIds: [T1], email: "a@b.com" });
    expect(res.status).toBe(404);
  });
});
