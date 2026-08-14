import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { PATCH } from "@/app/api/admin/events/[id]/settings/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(admins: { id: string; role: string }[], updateError: unknown = null) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "update"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve(table === "events" ? { data: null, error: updateError } : { data: admins, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function patch(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/admin/events/evt-1/settings", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedCreateAdminClient.mockReturnValue(adminClient(superAdmin));
});

describe("PATCH /api/admin/events/[id]/settings", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    const res = await patch({ seat_cap: 10 });
    expect(res.status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient([]));
    const res = await patch({ seat_cap: 10 });
    expect(res.status).toBe(403);
  });

  it("400s invalid JSON", async () => {
    const res = await patch("not json");
    expect(res.status).toBe(400);
  });

  it("persists a valid seat_cap for an admin", async () => {
    const res = await patch({ seat_cap: 25 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true });
  });

  it("500s when the update fails", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient(superAdmin, { message: "db error" }));
    const res = await patch({ seat_cap: 5 });
    expect(res.status).toBe(500);
  });

  // The per-event strict toggle was removed (check-in is strict for every event).
  // A PATCH carrying strict_checkin must be ignored: succeed without touching the
  // events table, never error, and never write the field.
  it("ignores strict_checkin as a no-op (does not error, does not write it)", async () => {
    const updateSpy = vi.fn();
    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "eq", "limit"]) c[m] = () => c;
        c.update = (payload: unknown) => {
          updateSpy(payload);
          return c;
        };
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve(
            table === "events"
              ? { data: null, error: null }
              : { data: superAdmin, error: null }
          );
        return c;
      },
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await patch({ strict_checkin: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    // No events.update fired — the field is dropped, not persisted.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("ignores strict_checkin but still applies a co-submitted seat_cap", async () => {
    const updateSpy = vi.fn();
    mockedCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "eq", "limit"]) c[m] = () => c;
        c.update = (payload: unknown) => {
          updateSpy(payload);
          return c;
        };
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve(
            table === "events"
              ? { data: null, error: null }
              : { data: superAdmin, error: null }
          );
        return c;
      },
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await patch({ strict_checkin: false, seat_cap: 12 });
    expect(res.status).toBe(200);
    // seat_cap persisted; strict_checkin not present in the update payload.
    expect(updateSpy).toHaveBeenCalledWith({ seat_cap: 12 });
  });

  describe("per-rate-class ticket limits", () => {
    function spiedAdmin() {
      const updateSpy = vi.fn();
      mockedCreateAdminClient.mockReturnValue({
        from: (table: string) => {
          const c: Record<string, unknown> = {};
          for (const m of ["select", "eq", "limit"]) c[m] = () => c;
          c.update = (payload: unknown) => {
            updateSpy(payload);
            return c;
          };
          (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
            resolve(
              table === "events" ? { data: null, error: null } : { data: superAdmin, error: null }
            );
          return c;
        },
      } as unknown as ReturnType<typeof createAdminClient>);
      return updateSpy;
    }

    // Covers AE6.
    it("rejects a limit above the absolute ceiling and persists nothing", async () => {
      const updateSpy = spiedAdmin();
      const res = await patch({ max_tickets_invite: 25 });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/20/);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("persists a valid limit for a single field", async () => {
      const updateSpy = spiedAdmin();
      const res = await patch({ max_tickets_invite: 4 });
      expect(res.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith({ max_tickets_invite: 4 });
    });

    it("clears a limit to null", async () => {
      const updateSpy = spiedAdmin();
      const res = await patch({ max_tickets_invite: null });
      expect(res.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith({ max_tickets_invite: null });
    });

    it("rejects a zero or non-integer limit", async () => {
      const updateSpy = spiedAdmin();
      const zero = await patch({ max_tickets_invite: 0 });
      expect(zero.status).toBe(400);
      const fractional = await patch({ max_tickets_member: 2.5 });
      expect(fractional.status).toBe(400);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("persists all three limits together", async () => {
      const updateSpy = spiedAdmin();
      const res = await patch({
        max_tickets_member: 8,
        max_tickets_invite: 4,
        max_tickets_non_member: 6,
      });
      expect(res.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith({
        max_tickets_member: 8,
        max_tickets_invite: 4,
        max_tickets_non_member: 6,
      });
    });
  });
});
