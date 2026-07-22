import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/household-tickets", () => ({
  resendHouseholdForAddress: vi.fn(),
}));

import { POST } from "@/app/api/admin/events/[id]/resend-household/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resendHouseholdForAddress } from "@/lib/email/household-tickets";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedResend = vi.mocked(resendHouseholdForAddress);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(opts: {
  admins: { id: string; role: string }[];
  event: Record<string, unknown> | null;
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
      // events
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({ data: opts.event, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown = { email: "house@x.ch" }) {
  const r = new Request("http://localhost/api/admin/events/evt-1/resend-household", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(r as never, { params: Promise.resolve({ id: "evt-1" }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];
const event = { id: "evt-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedResend.mockResolvedValue({ found: true, sent: true });
});

describe("POST resend-household (U15)", () => {
  it("resends the grouped email to the given address", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event }));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, email: "house@x.ch" });
    expect(mockedResend).toHaveBeenCalledWith("evt-1", "house@x.ch");
  });

  it("rejects a non-admin with 403", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [], event }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockedResend).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event }));
    const res = await post();
    expect(res.status).toBe(401);
    expect(mockedResend).not.toHaveBeenCalled();
  });

  it("requires an email", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event }));
    const res = await post({});
    expect(res.status).toBe(400);
    expect(mockedResend).not.toHaveBeenCalled();
  });

  it("returns 404 when the event does not exist", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event: null }));
    const res = await post();
    expect(res.status).toBe(404);
    expect(mockedResend).not.toHaveBeenCalled();
  });

  it("returns 404 when no tickets exist at that address", async () => {
    mockedResend.mockResolvedValue({ found: false, sent: false });
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event }));
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("surfaces a send failure as 502", async () => {
    mockedResend.mockResolvedValue({ found: true, sent: false });
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, event }));
    const res = await post();
    expect(res.status).toBe(502);
  });
});
