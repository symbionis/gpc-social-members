import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn(),
}));

import { POST } from "@/app/api/admin/events/[id]/registrations/resend-bulk/route";
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
  registrations: { id: string }[];
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
      // event_registrations — terminal is .is("ticket_email_sent_at", null)
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.is = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: opts.registrations, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post() {
  const r = new Request(
    "http://localhost/api/admin/events/evt-1/registrations/resend-bulk",
    { method: "POST" }
  );
  return POST(r as never, { params: Promise.resolve({ id: "evt-1" }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedSend.mockResolvedValue({ success: true });
});

describe("POST resend-bulk (U5)", () => {
  it("resends to every not-yet-notified registration with resend:true", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, registrations: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, sent: 3, failed: 0, total: 3 });
    expect(mockedSend).toHaveBeenCalledTimes(3);
    expect(mockedSend).toHaveBeenCalledWith("r1", { resend: true });
  });

  it("is a no-op when no one is awaiting notification", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, registrations: [] }));
    const res = await post();
    expect(await res.json()).toEqual({ success: true, sent: 0, failed: 0, total: 0 });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("counts partial failures without aborting the batch", async () => {
    mockedSend
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "boom" })
      .mockResolvedValueOnce({ success: true });
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, registrations: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] })
    );
    const res = await post();
    expect(await res.json()).toEqual({ success: true, sent: 2, failed: 1, total: 3 });
  });

  it("rejects a non-admin with 403", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [], registrations: [{ id: "r1" }] }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
