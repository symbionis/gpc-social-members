import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));

import { POST } from "@/app/api/admin/events/[id]/registrations/[regId]/resend-confirmation/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEventRegistrationConfirmation);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(opts: {
  admins: { id: string; role: string }[];
  registration: Record<string, unknown> | null;
  registrationError?: unknown;
}) {
  return {
    from: (table: string) => {
      if (table === "admin_users") {
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.eq = () => c;
        c.limit = () => c;
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.admins, error: null });
        return c;
      }
      // event_registrations
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({
        data: opts.registration,
        error: opts.registrationError ?? null,
      });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post() {
  const r = new Request(
    "http://localhost/api/admin/events/evt-1/registrations/reg-1/resend-confirmation",
    { method: "POST" }
  );
  return POST(r as never, { params: Promise.resolve({ id: "evt-1", regId: "reg-1" }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];
const paidReg = { id: "reg-1", email: "lead@example.com", status: "paid" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedSend.mockResolvedValue({ success: true });
});

describe("POST resend-confirmation (U3)", () => {
  it("resends a paid registration with resend:true and returns the email", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, registration: paidReg }));
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, email: "lead@example.com" });
    expect(mockedSend).toHaveBeenCalledWith("reg-1", { resend: true });
  });

  it("resends a free registration", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, registration: { ...paidReg, status: "free" } })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockedSend).toHaveBeenCalledWith("reg-1", { resend: true });
  });

  it("rejects a non-admin with 403", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [], registration: paidReg }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, registration: paidReg }));
    const res = await post();
    expect(res.status).toBe(401);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("returns 404 when the registration is not in this event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, registration: null }));
    const res = await post();
    expect(res.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("rejects a pending registration with 409 (no ticket email)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, registration: { ...paidReg, status: "pending" } })
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("surfaces a send failure as 502", async () => {
    mockedSend.mockResolvedValue({ success: false, error: "boom" });
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, registration: paidReg }));
    const res = await post();
    expect(res.status).toBe(502);
  });
});
