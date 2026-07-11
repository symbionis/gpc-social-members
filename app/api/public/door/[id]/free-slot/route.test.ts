import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/free-slot/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);

// The route delegates to the release_ticket RPC; the mock returns its result.
function adminClient(rel: Record<string, unknown> | null) {
  return {
    rpc: async (_fn: string, _args: unknown) => ({ data: rel, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/free-slot`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedAdmin.mockReturnValue(adminClient({ status: "ok", already: false }));
});

describe("POST /api/public/door/[id]/free-slot", () => {
  it("404s an unknown / unpublished event", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(404);
    expect(mockedAdmin).not.toHaveBeenCalled();
  });

  it("requires an attendeeId", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("404s a guest not on this event's roster (release_ticket → not_found)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "not_found" }));
    const res = await post({ attendeeId: "ghost" });
    expect(res.status).toBe(404);
  });

  it("refuses to remove the party lead (release_ticket → is_lead)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "is_lead" }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(400);
  });

  it("refuses to remove a checked-in guest (release_ticket → checked_in)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "checked_in" }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(409);
  });

  it("refuses to free a comp guest's seat (release_ticket → is_comp)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "is_comp" }));
    const res = await post({ attendeeId: "att-comp" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/guest list/i);
  });

  it("is idempotent for an already-released guest", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "ok", already: true }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
  });

  it("frees a live not-yet-arrived guest and reopens the slot", async () => {
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: false });
  });

  it("409s when the release loses to a concurrent check-in", async () => {
    mockedAdmin.mockReturnValue(adminClient({ status: "checked_in" }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(409);
  });
});
