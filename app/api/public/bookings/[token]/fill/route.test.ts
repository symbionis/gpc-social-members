import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/ticket-qr", () => ({ sendTicketQrEmail: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/fill/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedQr = vi.mocked(sendTicketQrEmail);

/** Updates written via `.from(...).update(...)`, so tests can assert the stamp clear. */
let updates: Record<string, unknown>[] = [];

// The route delegates to fill_ticket; the mock returns its result. Before the RPC it
// always looks up the registration (by manage_token) and the ticket (for is_child, the
// prior email, and qr_email_sent_at) — the mock serves those from `reg` / `ticket`.
function adminClient(
  fill: Record<string, unknown> | null,
  opts: { reg?: Record<string, unknown> | null; ticket?: Record<string, unknown> | null } = {}
) {
  const { reg = { id: "reg1" }, ticket = { is_child: false } } = opts;
  const table = (row: Record<string, unknown> | null) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return builder;
      },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
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
  updates = [];
  mockedQr.mockResolvedValue({ success: true });
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

  it("400s a ticket named with no email (QR can't be delivered) — no child exemption", async () => {
    const res = await post({ ticketId: TICKET, name: "Ann", phone: "+41791112233" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("email") });
  });

  it("404s when the ticket isn't in this booking", async () => {
    mockedAdmin.mockReturnValue(adminClient(null, { ticket: null }));
    const res = await post({ ticketId: TICKET, name: "Ann" });
    expect(res.status).toBe(404);
  });

  it("emails the named adult guest their own QR", async () => {
    await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
    expect(mockedQr).toHaveBeenCalledWith(TICKET);
  });

  it("sends no QR when the RPC didn't claim the ticket", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "not_found" }));
    await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
    expect(mockedQr).not.toHaveBeenCalled();
  });

  it("keeps the sent stamp when re-saving the same email (no double-send)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient(
        { status: "claimed", attendee_id: TICKET, name: "Ann" },
        { ticket: { is_child: false, email: "ann@x.com", qr_email_sent_at: "2026-07-01T00:00:00Z" } }
      )
    );
    await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
    // Stamp untouched — sendTicketQrEmail's own idempotency guard then skips the send.
    expect(updates).toEqual([]);
  });

  it("clears the sent stamp when the lead corrects a typo'd email, so the QR re-sends", async () => {
    mockedAdmin.mockReturnValue(
      adminClient(
        { status: "claimed", attendee_id: TICKET, name: "Ann" },
        { ticket: { is_child: false, email: "typo@x.com", qr_email_sent_at: "2026-07-01T00:00:00Z" } }
      )
    );
    await post({ ticketId: TICKET, name: "Ann", email: "ann@x.com" });
    expect(updates).toEqual([{ qr_email_sent_at: null }]);
    expect(mockedQr).toHaveBeenCalledWith(TICKET);
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
