import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/household-tickets", () => ({ sendHouseholdTicketEmails: vi.fn() }));

import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { sendHouseholdTicketEmails } from "@/lib/email/household-tickets";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);
const mockedHousehold = vi.mocked(sendHouseholdTicketEmails);

type Item = {
  ticket_type_id?: string | null;
  title_snapshot: string;
  quantity: number;
  unit_amount_chf: number;
  line_total_chf: number;
};
type Topup = { id: string; items: Item[]; applied_at?: string | null; stripe_payment_intent_id?: string | null };
type Conversion = {
  id: string;
  delta_chf: number;
  applied_at?: string | null;
  stripe_payment_intent_id?: string | null;
  from_type_id: string;
  to_type_id: string;
};

function adminClient(opts: {
  registration: Record<string, unknown>;
  event: Record<string, unknown>;
  items: Item[] | null;
  appliedTopups?: Topup[];
  topupById?: Topup;
  conversionById?: Conversion;
  ticketTypes?: { id: string; title: string }[];
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
      if (table === "event_registration_topups") {
        const c: Record<string, unknown> = {};
        let single = false;
        c.select = () => c;
        c.eq = (col: string) => {
          if (col === "id") single = true;
          return c;
        };
        c.limit = () => c;
        c.maybeSingle = async () => ({ data: opts.topupById ?? null, error: null });
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          single ? resolve({ data: null, error: null }) : resolve({ data: opts.appliedTopups ?? [], error: null });
        return c;
      }
      if (table === "event_ticket_type_conversions") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        c.maybeSingle = async () => ({ data: opts.conversionById ?? null, error: null });
        return c;
      }
      if (table === "event_ticket_types") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.in = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.ticketTypes ?? [], error: null });
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
  paid_at: "2026-06-01T10:00:00Z",
  stripe_payment_intent_id: "pi_original",
};
const baseEvent = { id: "evt-1", title: "Polo Brunch", start_date: "2026-06-15", start_time: "12:00:00", location: "GPC", visibility: "public" };

function lastModel() {
  return mockedSend.mock.calls[0][0].templateModel as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true });
  mockedHousehold.mockResolvedValue({ groups: 0, sent: 0 });
});

describe("sendEventRegistrationConfirmation — receipt lines (U4, original payment)", () => {
  it("builds one line per item with title, quantity and a CHF/Free label", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [
          { ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 80, line_total_chf: 160 },
          { ticket_type_id: "t-kids", title_snapshot: "Kids", quantity: 2, unit_amount_chf: 40, line_total_chf: 80 },
          { ticket_type_id: "t-drink", title_snapshot: "Welcome drink", quantity: 1, unit_amount_chf: 0, line_total_chf: 0 },
        ],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    // Covers R13/R15: itemised receipt — per-line unit price + line total + total + reference.
    expect(model.receipt_lines).toEqual([
      { title: "Standard", quantity: 2, unitLabel: "CHF 80.00", lineLabel: "CHF 160.00" },
      { title: "Kids", quantity: 2, unitLabel: "CHF 40.00", lineLabel: "CHF 80.00" },
      { title: "Welcome drink", quantity: 1, unitLabel: "Free", lineLabel: "Free" },
    ]);
    expect(model.amount_label).toBe("CHF 240.00");
    expect(model.reference_code).toBe(baseReg.reference_code);
    expect(model.charge_reference).toBe("pi_original");
    expect(model.paid_date_label).toBeTruthy();
  });

  it("falls back to a single synthesized line when the registration has no items", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [] })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.receipt_lines).toEqual([
      { title: "Registration", quantity: 4, unitLabel: "CHF 60.00", lineLabel: "CHF 240.00" },
    ]);
  });

  it("labels an all-free registration's lines and total as Free", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: { ...baseReg, total_amount_chf: 0, status: "free" },
        event: baseEvent,
        items: [{ ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 0, line_total_chf: 0 }],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.is_free).toBe(true);
    expect(model.amount_label).toBe("Free");
    expect((model.receipt_lines as { lineLabel: string }[])[0].lineLabel).toBe("Free");
  });

  it("subtracts an applied buy-more's contribution so the original receipt isn't inflated (KTD3)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [{ ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 6, unit_amount_chf: 80, line_total_chf: 480 }],
        appliedTopups: [
          { id: "top-1", items: [{ ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 80, line_total_chf: 160 }] },
        ],
      })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.receipt_lines).toEqual([
      { title: "Standard", quantity: 4, unitLabel: "CHF 80.00", lineLabel: "CHF 320.00" },
    ]);
    expect(model.amount_label).toBe("CHF 320.00");
  });
});

describe("sendEventRegistrationConfirmation — receipt carries no management link or QR (Covers AE9/R15)", () => {
  it("the template model has no manage_url and no qr_url anywhere", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ registration: baseReg, event: baseEvent, items: [] })
    );
    await sendEventRegistrationConfirmation("reg-1");
    const model = lastModel();
    expect(model.manage_url).toBeUndefined();
    expect(model.tickets).toBeUndefined();
    expect(JSON.stringify(model)).not.toMatch(/qr_url/);
  });
});

describe("sendEventRegistrationConfirmation — paying-row identifier (U4)", () => {
  it("a topup receipt renders ONLY that topup's own contributed lines, not the whole booking", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [{ ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 6, unit_amount_chf: 80, line_total_chf: 480 }],
        topupById: {
          id: "top-1",
          items: [{ ticket_type_id: "t-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 80, line_total_chf: 160 }],
          applied_at: "2026-07-01T10:00:00Z",
          stripe_payment_intent_id: "pi_topup",
        },
      })
    );
    await sendEventRegistrationConfirmation("reg-1", { payingRow: { type: "topup", id: "top-1" } });
    const model = lastModel();
    expect(model.receipt_lines).toEqual([
      { title: "Standard", quantity: 2, unitLabel: "CHF 80.00", lineLabel: "CHF 160.00" },
    ]);
    expect(model.amount_label).toBe("CHF 160.00");
    expect(model.charge_reference).toBe("pi_topup");
  });

  it("a conversion receipt renders a single upgrade-delta line, not the item-lines table", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        registration: baseReg,
        event: baseEvent,
        items: [{ ticket_type_id: "t-vip", title_snapshot: "VIP", quantity: 1, unit_amount_chf: 150, line_total_chf: 150 }],
        conversionById: {
          id: "conv-1",
          delta_chf: 70,
          applied_at: "2026-07-05T10:00:00Z",
          stripe_payment_intent_id: "pi_conv",
          from_type_id: "t-std",
          to_type_id: "t-vip",
        },
        ticketTypes: [
          { id: "t-std", title: "Standard" },
          { id: "t-vip", title: "VIP" },
        ],
      })
    );
    await sendEventRegistrationConfirmation("reg-1", { payingRow: { type: "conversion", id: "conv-1" } });
    const model = lastModel();
    expect(model.receipt_lines).toEqual([
      { title: "Upgrade: Standard → VIP", quantity: 1, unitLabel: "CHF 70.00", lineLabel: "CHF 70.00" },
    ]);
    expect(model.amount_label).toBe("CHF 70.00");
    expect(model.charge_reference).toBe("pi_conv");
  });
});

describe("sendEventRegistrationConfirmation — payer still gets their ticket via the ticket-email path (U4)", () => {
  it("delegates ALL ticket/QR delivery (payer included) to the grouped household send", async () => {
    mockedAdmin.mockReturnValue(adminClient({ registration: baseReg, event: baseEvent, items: [] }));
    await sendEventRegistrationConfirmation("reg-1");
    // household-tickets.ts now includes the payer's own ticket (is_lead filter dropped there);
    // this test only asserts the delegation happens — the inclusion itself is covered in
    // household-tickets.test.ts.
    expect(mockedHousehold).toHaveBeenCalledWith("reg-1");
  });

  it("a grouped-send failure never rejects the confirmation", async () => {
    mockedHousehold.mockRejectedValueOnce(new Error("postmark down"));
    mockedAdmin.mockReturnValue(adminClient({ registration: baseReg, event: baseEvent, items: [] }));
    await expect(sendEventRegistrationConfirmation("reg-1")).resolves.toBeDefined();
  });
});

describe("sendEventRegistrationConfirmation — resend flag + send stamp", () => {
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
