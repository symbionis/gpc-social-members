import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);

type Item = { title_snapshot: string; quantity: number; line_total_chf: number };

function adminClient(opts: {
  registration: Record<string, unknown>;
  event: Record<string, unknown>;
  items: Item[] | null;
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
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.single = async () => ({
        data: table === "events" ? opts.event : opts.registration,
        error: null,
      });
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
};
const baseEvent = { id: "evt-1", title: "Polo Brunch", start_date: "2026-06-15", start_time: "12:00:00", location: "GPC", visibility: "public" };

function lastModel() {
  return mockedSend.mock.calls[0][0].templateModel as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ success: true });
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
