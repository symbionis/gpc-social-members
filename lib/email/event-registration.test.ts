import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/ticket-qr", () => ({ sendTicketQrEmail: vi.fn() }));

import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);
const mockedGuestQr = vi.mocked(sendTicketQrEmail);

type Item = { title_snapshot: string; quantity: number; line_total_chf: number };

function adminClient(opts: {
  registration: Record<string, unknown>;
  event: Record<string, unknown>;
  items: Item[] | null;
  tickets?: { credential_token: string | null; name: string | null; is_lead?: boolean }[];
  /** Rows returned for the guest QR fan-out query (is_lead=false), distinct from `tickets` (the lead-QR query). */
  guestTickets?: { id: string; email?: string | null; qr_email_sent_at?: string | null }[];
  /** Records each event_registrations.update({...}) payload (the success stamp). */
  updateCalls?: Record<string, unknown>[];
  /** Forces the stamp update to fail, to test best-effort logging. */
  stampError?: unknown;
}) {
  return {
    from: (table: string) => {
      if (table === "event_registration_items") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.order = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.items, error: null });
        return c;
      }
      if (table === "tickets") {
        const c: Record<string, unknown> = {};
        let filteringByLead = false;
        c.select = () => c;
        c.eq = (col: string, val: unknown) => {
          if (col === "is_lead") filteringByLead = val === false;
          return c;
        };
        c.in = () => c;
        c.is = () => c;
        c.order = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: (filteringByLead ? opts.guestTickets : opts.tickets) ?? [], error: null });
        return c;
      }
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.single = async () => ({
        data: table === "events" ? opts.event : opts.registration,
        error: null,
      });
      // Success stamp: event_registrations.update({ ticket_email_sent_at }).eq("id", …)
      c.update = (vals: Record<string, unknown>) => {
        opts.updateCalls?.push(vals);
        return { eq: async () => ({ error: opts.stampError ?? null }) };
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const baseReg = {
  id: "reg-1",
  name: "Jean Dupont",
  email: "jean@example.com",
  quantity: 4,
  total_amount_chf: 240,
  reference_code: "EV-ABCD1234",
  status: "paid",
  event_id: "evt-1",
  self_reg_token: "selfregtoken-abc",
};
const baseEvent = { id: "evt-1", title: "Polo Brunch", start_date: "2026-06-15", start_time: "12:00:00", location: "GPC", visibility: "public" };

function lastModel() {
  return mockedSend.mock.calls[0][0].templateModel as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true });
  mockedGuestQr.mockResolvedValue({ success: true });
});

describe("sendEventRegistrationConfirmation — ticket_lines breakdown", () => {
  it("builds one line per item with title, quantity and a CHF/Free label", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [
          { title_snapshot: "Standard", quantity: 2, line_total_chf: 160 },
          { title_snapshot: "Kids", quantity: 2, line_total_chf: 80 },
          { title_snapshot: "Welcome drink", quantity: 1, line_total_chf: 0 },
        ],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.ticket_lines).toEqual([
      { title: "Standard", quantity: 2, line_label: "CHF 160.00" },
      { title: "Kids", quantity: 2, line_label: "CHF 80.00" },
      { title: "Welcome drink", quantity: 1, line_label: "Free" },
    ]);
    expect(model.amount_label).toBe("CHF 240.00");
  });

  it("falls back to a single synthesized line when the registration has no items", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [] })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.ticket_lines).toEqual([
      { title: "Registration", quantity: 4, line_label: "CHF 240.00" },
    ]);
  });

  it("labels an all-free registration's lines and total as Free", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, total_amount_chf: 0, status: "free" },
        event: baseEvent,
        items: [{ title_snapshot: "Standard", quantity: 2, line_total_chf: 0 }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.is_free).toBe(true);
    expect(model.amount_label).toBe("Free");
    expect((model.ticket_lines as { line_label: string }[])[0].line_label).toBe("Free");
  });
});

describe("sendEventRegistrationConfirmation — booking link + lead QR (FEAT-41)", () => {
  it("includes manage_url and ONLY the lead's own QR (the code they show at the door)", async () => {
    // The DB query filters is_lead=true, so the row set is the lead's ticket only;
    // guests' QRs are reached via the booking page (manage_url), not the email.
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, manage_token: "mtok-xyz" },
        event: baseEvent,
        items: [],
        tickets: [{ credential_token: "credAAA", name: "Jean", is_lead: true }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.manage_url).toBe("http://localhost:3000/public/bookings/mtok-xyz");
    expect(model.tickets).toEqual([
      { label: "Your ticket", name: "Jean", qr_url: "http://localhost:3000/api/qr/credAAA" },
    ]);
  });

  it("drops a lead ticket with no credential token (QR still reachable via manage_url)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, manage_token: "mtok-xyz" },
        event: baseEvent,
        items: [],
        tickets: [{ credential_token: null, name: "Jean", is_lead: true }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(lastModel().tickets).toEqual([]);
  });

  it("manage_url is null (never empty) when the registration has no token", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [], tickets: [] })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(lastModel().manage_url).toBeNull();
    expect(lastModel().tickets).toEqual([]);
  });
});

describe("sendEventRegistrationConfirmation — guest QR fan-out (R6/R8)", () => {
  it("covers R6/R8: emails every guest ticket with an email its QR", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [],
        guestTickets: [{ id: "tkt-kid", email: "kid@x.ch", qr_email_sent_at: null }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(mockedGuestQr).toHaveBeenCalledWith("tkt-kid");
  });

  it("still skips a guest ticket with no email", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [],
        guestTickets: [{ id: "tkt-noemail", email: null, qr_email_sent_at: null }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(mockedGuestQr).not.toHaveBeenCalled();
  });

  it("still skips a guest ticket whose QR was already sent", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [],
        guestTickets: [{ id: "tkt-sent", email: "g@x.ch", qr_email_sent_at: "2026-07-01T00:00:00Z" }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(mockedGuestQr).not.toHaveBeenCalled();
  });
});

describe("sendEventRegistrationConfirmation — self-registration link (U10)", () => {
  it("includes the self_registration_url for a multi-ticket party with a token", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [] })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(lastModel().self_registration_url).toBe(
      "http://localhost:3000/public/registrations/selfregtoken-abc"
    );
  });

  it("is null for a solo (quantity 1) booking — no guests to invite", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, quantity: 1 },
        event: baseEvent,
        items: [],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(lastModel().self_registration_url).toBeNull();
  });

  it("is null (never empty string) when the registration has no token", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, self_reg_token: null },
        event: baseEvent,
        items: [],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    expect(lastModel().self_registration_url).toBeNull();
  });
});

describe("sendEventRegistrationConfirmation — resend flag + send stamp (U2)", () => {
  it("defaults resend to false and stamps ticket_email_sent_at on success", async () => {
    const updateCalls: Record<string, unknown>[] = [];
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [], updateCalls })
    );
    const res = await sendEventRegistrationConfirmation("reg-1");
    expect(res.success).toBe(true);
    expect(lastModel().resend).toBe(false);
    // Exactly one stamp, carrying a ticket_email_sent_at timestamp.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toHaveProperty("ticket_email_sent_at");
    expect(typeof updateCalls[0].ticket_email_sent_at).toBe("string");
  });

  it("propagates resend: true into the template model", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [] })
    );
    await sendEventRegistrationConfirmation("reg-1", { resend: true });
    expect(lastModel().resend).toBe(true);
  });

  it("does NOT stamp when the email send fails (row stays not-yet-notified)", async () => {
    const updateCalls: Record<string, unknown>[] = [];
    mockedSend.mockResolvedValueOnce({ success: false, error: "boom" });
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [], updateCalls })
    );
    const res = await sendEventRegistrationConfirmation("reg-1");
    expect(res.success).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  it("still reports success when the stamp update fails (best-effort)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [],
        stampError: "stamp failed",
      })
    );
    const res = await sendEventRegistrationConfirmation("reg-1");
    expect(res.success).toBe(true);
  });
});
