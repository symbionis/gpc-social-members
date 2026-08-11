import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendWaitlistOffer } from "@/lib/email/event-waitlist-offer";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSendEmail = vi.mocked(sendEmail);

// Minimal chainable query builder stub keyed by table name. Each table's
// terminal `.maybeSingle()` resolves from the row map passed in.
function client(rows: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const entry = {
  id: "w1",
  name: "Jean Dupont",
  email: "jean@x.ch",
  quantity: 2,
  offer_token: "tok_abc123",
  event_id: "e1",
  ticket_type_id: "tt1",
};
const event = {
  id: "e1",
  title: "Open Doors",
  start_date: "2026-05-22",
  start_time: "18:00:00",
  location: "Polo Field",
  visibility: "public",
};
const ticketType = { title: "Dinner" };

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  mockedSendEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

describe("sendWaitlistOffer", () => {
  it("sends the offer URL, event name, quantity, and ticket type title in the template model", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_waitlist: entry,
        events: event,
        event_ticket_types: ticketType,
      })
    );

    const result = await sendWaitlistOffer("w1");

    expect(result.success).toBe(true);
    expect(mockedSendEmail).toHaveBeenCalledOnce();
    const arg = mockedSendEmail.mock.calls[0][0];
    expect(arg.to).toBe("jean@x.ch");
    expect(arg.templateAlias).toBe("event-waitlist-offer");
    expect(arg.templateModel).toMatchObject({
      offer_url: "https://app.example.com/public/offers/tok_abc123",
      event_title: "Open Doors",
      quantity: 2,
      ticket_type_title: "Dinner",
      first_name: "Jean",
    });
  });

  it("returns failure without sending when the entry has no offer token", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_waitlist: { ...entry, offer_token: null },
        events: event,
        event_ticket_types: ticketType,
      })
    );

    const result = await sendWaitlistOffer("w1");

    expect(result.success).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns failure without calling Postmark when the entry is missing", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({ event_waitlist: null, events: event, event_ticket_types: ticketType })
    );

    const result = await sendWaitlistOffer("missing");

    expect(result.success).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("surfaces a Postmark error as { success: false } without throwing", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_waitlist: entry,
        events: event,
        event_ticket_types: ticketType,
      })
    );
    mockedSendEmail.mockResolvedValue({ success: false, error: "boom" });

    const result = await sendWaitlistOffer("w1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });
});
