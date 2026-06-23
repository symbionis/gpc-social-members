import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));

import { POST } from "@/app/api/public/door/[id]/resend-confirmation/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);
const mockedSend = vi.mocked(sendEventRegistrationConfirmation);

function adminClient(registration: Record<string, unknown> | null, error: unknown = null) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({ data: registration, error });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/resend-confirmation`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

const paidReg = { id: "reg-1", email: "lead@example.com", status: "paid" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedAdmin.mockReturnValue(adminClient(paidReg));
  mockedSend.mockResolvedValue({ success: true });
});

describe("POST /api/public/door/[id]/resend-confirmation", () => {
  it("404s an unknown / unpublished event without sending", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post({ registrationId: "reg-1" });
    expect(res.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("requires a registrationId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("resends a paid booking with resend:true", async () => {
    const res = await post({ registrationId: "reg-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, email: "lead@example.com" });
    expect(mockedSend).toHaveBeenCalledWith("reg-1", { resend: true });
  });

  it("404s a booking not on this event", async () => {
    mockedAdmin.mockReturnValue(adminClient(null));
    const res = await post({ registrationId: "ghost" });
    expect(res.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("rejects a pending booking with 409", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ...paidReg, status: "pending" }));
    const res = await post({ registrationId: "reg-1" });
    expect(res.status).toBe(409);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("surfaces a send failure as 502", async () => {
    mockedSend.mockResolvedValue({ success: false, error: "boom" });
    const res = await post({ registrationId: "reg-1" });
    expect(res.status).toBe(502);
  });
});
