import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendTicketQrEmail } from "@/lib/email/ticket-qr";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);

type TicketRow = Record<string, unknown> | null;

function adminClient(opts: {
  ticket: TicketRow;
  event?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
  updateCalls?: Record<string, unknown>[];
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({
        data:
          table === "events"
            ? opts.event ?? null
            : table === "event_registrations"
            ? opts.reg ?? null
            : opts.ticket,
        error: null,
      });
      c.update = (vals: Record<string, unknown>) => {
        opts.updateCalls?.push(vals);
        return { eq: async () => ({ error: null }) };
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const liveAdultTicket = {
  id: "tkt-1",
  event_id: "evt-1",
  registration_id: "reg-1",
  name: "Bo Guest",
  email: "bo@example.com",
  is_child: false,
  released_at: null,
  credential_token: "credXYZ",
  qr_email_sent_at: null,
};
const event = { title: "Polo Brunch", start_date: "2026-06-15", start_time: "12:00:00", location: "GPC" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true });
});

describe("sendTicketQrEmail", () => {
  it("sends the guest their QR and stamps qr_email_sent_at on success", async () => {
    const updateCalls: Record<string, unknown>[] = [];
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: liveAdultTicket,
        event,
        reg: { reference_code: "EV-ABCD1234", name: "Lead Booker" },
        updateCalls,
      })
    );
    const res = await sendTicketQrEmail("tkt-1");
    expect(res.success).toBe(true);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const arg = mockedSend.mock.calls[0][0];
    expect(arg.to).toBe("bo@example.com");
    expect(arg.templateAlias).toBe("event-ticket");
    expect(arg.templateModel).toMatchObject({
      event_title: "Polo Brunch",
      qr_url: "http://localhost:3000/api/qr/credXYZ",
      reference_code: "EV-ABCD1234",
      guest_name: "Bo Guest",
      first_name: "Bo",
      inviter_name: "Lead Booker",
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toHaveProperty("qr_email_sent_at");
  });

  it("omits inviter_name when the booker is the guest themselves", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ ticket: liveAdultTicket, event, reg: { reference_code: "EV-1", name: "bo guest" } })
    );
    await sendTicketQrEmail("tkt-1");
    expect(mockedSend.mock.calls[0][0].templateModel.inviter_name).toBeNull();
  });

  it("skips a ticket with no email (a phone-only guest can't receive a QR)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: { ...liveAdultTicket, email: null } }));
    const res = await sendTicketQrEmail("tkt-1");
    expect(res.skipped).toBe("no_email");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("skips a name-only child ticket", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: { ...liveAdultTicket, is_child: true } }));
    const res = await sendTicketQrEmail("tkt-1");
    expect(res.skipped).toBe("child");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("skips a ticket already sent (idempotent — no double-send)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ ticket: { ...liveAdultTicket, qr_email_sent_at: "2026-07-01T00:00:00Z" } })
    );
    const res = await sendTicketQrEmail("tkt-1");
    expect(res.skipped).toBe("already_sent");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("skips a released ticket", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ ticket: { ...liveAdultTicket, released_at: "2026-07-01T00:00:00Z" } })
    );
    expect((await sendTicketQrEmail("tkt-1")).skipped).toBe("released");
  });

  it("does NOT stamp when the send fails (stays eligible for retry)", async () => {
    const updateCalls: Record<string, unknown>[] = [];
    mockedSend.mockResolvedValueOnce({ success: false, error: "boom" });
    mockedAdmin.mockReturnValue(adminClient({ ticket: liveAdultTicket, event, reg: null, updateCalls }));
    const res = await sendTicketQrEmail("tkt-1");
    expect(res.success).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});
