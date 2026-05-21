import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendWaitlistConfirmation } from "@/lib/email/event-waitlist";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSendEmail = vi.mocked(sendEmail);

function client(reg: unknown, event: unknown) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.single = async () =>
        table === "events" ? { data: event, error: null } : { data: reg, error: null };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const reg = {
  id: "r1",
  name: "Jean Dupont",
  email: "jean@x.ch",
  quantity: 2,
  reference_code: "EV-ABCD1234",
  event_id: "e1",
};
const event = {
  id: "e1",
  title: "Open Doors",
  start_date: "2026-05-22",
  start_time: "18:00:00",
  location: "Polo Field",
  visibility: "public",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendEmail.mockResolvedValue({ success: true });
});

describe("sendWaitlistConfirmation", () => {
  it("sends the event-waitlist-confirmed template with the right model", async () => {
    mockedCreateAdminClient.mockReturnValue(client(reg, event));
    const result = await sendWaitlistConfirmation("r1");

    expect(result.success).toBe(true);
    expect(mockedSendEmail).toHaveBeenCalledOnce();
    const arg = mockedSendEmail.mock.calls[0][0];
    expect(arg.to).toBe("jean@x.ch");
    expect(arg.templateAlias).toBe("event-waitlist-confirmed");
    expect(arg.templateModel).toMatchObject({
      first_name: "Jean",
      event_title: "Open Doors",
      quantity: 2,
      reference_code: "EV-ABCD1234",
    });
  });

  it("does not use the standard registration template alias", async () => {
    mockedCreateAdminClient.mockReturnValue(client(reg, event));
    await sendWaitlistConfirmation("r1");
    expect(mockedSendEmail.mock.calls[0][0].templateAlias).not.toBe(
      "event-registration-confirmed"
    );
  });

  it("returns failure and skips sending when the registration is missing", async () => {
    mockedCreateAdminClient.mockReturnValue(client(null, event));
    const result = await sendWaitlistConfirmation("missing");
    expect(result.success).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns failure (logged) when sendEmail fails, without throwing", async () => {
    mockedCreateAdminClient.mockReturnValue(client(reg, event));
    mockedSendEmail.mockResolvedValue({ success: false, error: "boom" });
    const result = await sendWaitlistConfirmation("r1");
    expect(result.success).toBe(false);
  });
});
