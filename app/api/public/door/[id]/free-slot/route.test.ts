import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/free-slot/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);

type Row = Record<string, unknown> | null;

function adminClient(opts: { attendee: Row; updated?: unknown[] }) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => ({ data: opts.attendee, error: null });
      c.update = () => {
        const u: Record<string, unknown> = {};
        u.eq = () => u;
        u.is = () => u;
        u.select = () => u;
        (u as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ data: opts.updated ?? [{ id: "att-1" }], error: null });
        return u;
      };
      return c;
    },
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

const liveGuest = { id: "att-1", is_lead: false, checked_in_at: null, released_at: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedAdmin.mockReturnValue(adminClient({ attendee: liveGuest }));
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

  it("404s a guest not on this event's roster", async () => {
    mockedAdmin.mockReturnValue(adminClient({ attendee: null }));
    const res = await post({ attendeeId: "ghost" });
    expect(res.status).toBe(404);
  });

  it("refuses to remove the party lead", async () => {
    mockedAdmin.mockReturnValue(adminClient({ attendee: { ...liveGuest, is_lead: true } }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(400);
  });

  it("refuses to remove a checked-in guest (arrivals are permanent)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ attendee: { ...liveGuest, checked_in_at: "2026-06-06T18:00:00Z" } })
    );
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(409);
  });

  it("is idempotent for an already-released guest", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ attendee: { ...liveGuest, released_at: "2026-06-05T10:00:00Z" } })
    );
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
  });

  it("frees a live not-yet-arrived guest", async () => {
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: false });
  });

  it("409s when the guarded update loses to a concurrent check-in", async () => {
    mockedAdmin.mockReturnValue(adminClient({ attendee: liveGuest, updated: [] }));
    const res = await post({ attendeeId: "att-1" });
    expect(res.status).toBe(409);
  });
});
