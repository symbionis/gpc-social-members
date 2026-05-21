import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/broadcast/event-audience", () => ({ resolveEventAudience: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/messages/preview/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventAudience } from "@/lib/broadcast/event-audience";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveEventAudience);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(admins: { id: string; role: string }[], event: { id: string } | null) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: table === "events" ? event : null, error: null });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: table === "admin_users" ? admins : null, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "e1") {
  const req = new Request("http://localhost/api/admin/events/e1/messages/preview", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const eventsAdmin = [{ id: "a1", role: "events_admin" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "ea@x.com" }));
  mockedCreateAdminClient.mockReturnValue(adminClient(eventsAdmin, { id: "e1" }));
  mockedResolve.mockResolvedValue({ recipients: [], skipped: 0 });
});

describe("POST /api/admin/events/[id]/messages/preview", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post({ kind: "event_pre" })).status).toBe(401);
  });

  it("403s a non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient([], { id: "e1" }));
    expect((await post({ kind: "event_pre" })).status).toBe(403);
  });

  it("404s when the event does not exist", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient(eventsAdmin, null));
    expect((await post({ kind: "event_pre" })).status).toBe(404);
  });

  it("does not require subject/body for a preview", async () => {
    mockedResolve.mockResolvedValue({
      recipients: [{ member_id: null, email: "a@x.com", first_name: "A", last_name: "", tier_name: null }],
      skipped: 0,
    });
    const res = await post({ kind: "event_pre" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recipient_count: 1, skipped_count: 0 });
  });

  it("400s an invalid kind", async () => {
    expect((await post({ kind: "newsletter" })).status).toBe(400);
  });

  // AE4: the recipient count grows when the override is on.
  it("returns a higher count for event_post when include_non_consented is true", async () => {
    mockedResolve.mockImplementation(async ({ include_non_consented }) => ({
      recipients: include_non_consented
        ? [
            { member_id: null, email: "a@x.com", first_name: "A", last_name: "", tier_name: null },
            { member_id: null, email: "b@x.com", first_name: "B", last_name: "", tier_name: null },
          ]
        : [{ member_id: null, email: "a@x.com", first_name: "A", last_name: "", tier_name: null }],
      skipped: include_non_consented ? 0 : 1,
    }));

    const off = await (await post({ kind: "event_post", include_non_consented: false })).json();
    const on = await (await post({ kind: "event_post", include_non_consented: true })).json();
    expect(off).toEqual({ recipient_count: 1, skipped_count: 1 });
    expect(on).toEqual({ recipient_count: 2, skipped_count: 0 });
  });
});
