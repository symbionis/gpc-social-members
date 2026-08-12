import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));
vi.mock("@/lib/email/ticket-qr", () => ({ sendTicketQrEmail: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/resend-ticket/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);
const mockedSend = vi.mocked(sendTicketQrEmail);

const TICKET_ID = "11111111-2222-4333-8444-555555555555";

/**
 * Table-aware mock. `updates` records every tickets.update() payload so a test can assert
 * the idempotency stamp was cleared before the send — the whole point of the door resend.
 */
function adminClient(
  ticket: Record<string, unknown> | null,
  opts: { lookupError?: unknown; updateError?: unknown; updates?: Record<string, unknown>[] } = {}
) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({ data: ticket, error: opts.lookupError ?? null });
      c.update = (payload: Record<string, unknown>) => {
        opts.updates?.push(payload);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ error: opts.updateError ?? null });
        return chain;
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/resend-ticket`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

const liveTicket = {
  id: TICKET_ID,
  email: "guest@example.com",
  released_at: null,
  credential_token: "cred-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedAdmin.mockReturnValue(adminClient(liveTicket));
  mockedSend.mockResolvedValue({ success: true });
});

describe("POST /api/public/door/[id]/resend-ticket", () => {
  it("404s an unknown / unpublished event without sending", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("requires a ticketId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid ticketId rather than querying on it", async () => {
    const res = await post({ ticketId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  // The reason this route exists: the guest at the desk has already been sent their QR, so
  // sendTicketQrEmail's qr_email_sent_at guard would skip the send. Clearing the stamp first
  // is what turns the button back into a real send.
  it("clears the already-sent stamp before sending, so a resend actually sends", async () => {
    const updates: Record<string, unknown>[] = [];
    mockedAdmin.mockReturnValue(adminClient(liveTicket, { updates }));
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ qr_email_sent_at: null }]);
    expect(mockedSend).toHaveBeenCalledWith(TICKET_ID);
  });

  it("sends to the ticket holder's own address, not the lead's", async () => {
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, email: "guest@example.com" });
  });

  it("404s a ticket not on this event", async () => {
    mockedAdmin.mockReturnValue(adminClient(null));
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("refuses a released ticket with 409", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ...liveTicket, released_at: "2026-01-01" }));
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(409);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  // Checked BEFORE the stamp is cleared: there is nothing to send to, and clearing would
  // leave the ticket looking un-notified for no reason.
  it("refuses a ticket with no email without clearing its stamp", async () => {
    const updates: Record<string, unknown>[] = [];
    mockedAdmin.mockReturnValue(adminClient({ ...liveTicket, email: null }, { updates }));
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(409);
    expect(updates).toEqual([]);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("surfaces a send failure as 502", async () => {
    mockedSend.mockResolvedValue({ success: false, skipped: "not_found" });
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(502);
  });

  it("does not attempt the send when the stamp could not be cleared", async () => {
    mockedAdmin.mockReturnValue(adminClient(liveTicket, { updateError: { message: "nope" } }));
    const res = await post({ ticketId: TICKET_ID });
    expect(res.status).toBe(502);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
