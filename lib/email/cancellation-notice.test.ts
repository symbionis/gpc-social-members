import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendCancellationNotices } from "@/lib/email/cancellation-notice";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);

const TICKET_ID = "44444444-4444-4444-4444-444444444444";

const TICKET = {
  id: TICKET_ID,
  name: "Holder Holly",
  email: "holder@x.com",
  registration_id: "reg-1",
  is_comp: false,
};
const REG = {
  id: "reg-1",
  name: "Payer Pat",
  email: "payer@x.com",
  status: "paid",
  event_id: "evt-1",
  reference_code: "ABC123",
};
const EVENT = {
  title: "Polo Party",
  start_date: "2026-07-26",
  start_time: "18:00:00",
  location: "Grounds",
};

function adminClient(opts: {
  ticket?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => {
        if (table === "tickets") return { data: "ticket" in opts ? opts.ticket : TICKET, error: null };
        if (table === "event_registrations") return { data: "reg" in opts ? opts.reg : REG, error: null };
        if (table === "events") return { data: "event" in opts ? opts.event : EVENT, error: null };
        return { data: null, error: null };
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true } as never);
});

describe("sendCancellationNotices", () => {
  it("a holder cancelling on a different payer's booking produces two emails", async () => {
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    const [holderCall, payerCall] = mockedSend.mock.calls;
    expect(holderCall[0]).toMatchObject({ to: "holder@x.com", templateAlias: "event-cancellation-holder" });
    expect(payerCall[0]).toMatchObject({ to: "payer@x.com", templateAlias: "event-cancellation-payer" });
    expect(res).toEqual({ holderSent: true, payerSent: true });
  });

  it("covers AE6/R17: payer and holder share an address → one email only", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ ticket: { ...TICKET, email: "same@x.com" }, reg: { ...REG, email: "same@x.com" } })
    );
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0][0]).toMatchObject({ templateAlias: "event-cancellation-holder" });
    expect(res).toEqual({ holderSent: true, payerSent: false });
  });

  it("addresses differing only in case or surrounding whitespace count as the same address", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: { ...TICKET, email: "  Same@X.com " },
        reg: { ...REG, email: "same@x.com" },
      })
    );
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(res.payerSent).toBe(false);
  });

  // No payment gate. U5 first skipped the payer notice on free and comp bookings because the
  // template promised a refund, which a seat costing nothing never earns. That line is gone —
  // the email now only reports that a seat the payer arranged was released, which is as true
  // of a free seat as a paid one. Both cases notify the payer like any other booking.
  it("a free booking still notifies the payer — the notice no longer promises a refund", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: { ...REG, status: "free" } }));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend.mock.calls[0][0]).toMatchObject({ templateAlias: "event-cancellation-holder" });
    expect(mockedSend.mock.calls[1][0]).toMatchObject({ templateAlias: "event-cancellation-payer" });
    expect(res).toEqual({ holderSent: true, payerSent: true });
  });

  it("a comp ticket still notifies the payer", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: { ...TICKET, is_comp: true } }));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ holderSent: true, payerSent: true });
  });

  it("a failing holder send is logged and does not throw, and the payer send is still attempted", async () => {
    mockedSend.mockResolvedValueOnce({ success: false, error: "boom" } as never);
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(res).toEqual({ holderSent: false, payerSent: true });
  });

  it("a failing payer send is logged and does not throw", async () => {
    mockedSend.mockResolvedValueOnce({ success: true } as never);
    mockedSend.mockResolvedValueOnce({ success: false, error: "boom" } as never);
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(res).toEqual({ holderSent: true, payerSent: false });
  });

  it("returns no-op when the ticket has no registration", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: { ...TICKET, registration_id: null } }));
    const res = await sendCancellationNotices(TICKET_ID);
    expect(mockedSend).not.toHaveBeenCalled();
    expect(res).toEqual({ holderSent: false, payerSent: false });
  });
});
