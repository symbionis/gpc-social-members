import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedServer = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);

function authClient(user: { email?: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type RpcResult = { data: unknown; error: unknown };

// Admin client serving both assertAdmin (admin_users lookup) and importAttendees
// (rpc import_event_attendees). createAdminClient() is called by both; the same
// mock instance answers from() and rpc().
function adminClient(opts: {
  role?: string;
  rpcResult?: RpcResult;
  onRpc?: (args: { p_event_id: string; p_rows: unknown[] }) => void;
}) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = async () => ({
        data: opts.role ? [{ id: "admin-1", role: opts.role }] : [],
        error: null,
      });
      return c;
    },
    rpc: async (_name: string, args: { p_event_id: string; p_rows: unknown[] }) => {
      opts.onRpc?.(args);
      return opts.rpcResult ?? { data: [], error: null };
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const params = Promise.resolve({ id: "evt-1" });

function run(body: unknown) {
  const req = { json: async () => body } as unknown as Parameters<typeof POST>[0];
  return POST(req, { params });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/admin/events/[id]/attendees/import", () => {
  it("rejects an unauthenticated request (401)", async () => {
    mockedServer.mockResolvedValue(authClient(null));
    mockedAdmin.mockReturnValue(adminClient({ role: "events_admin" }));
    expect((await run({ text: "x" })).status).toBe(401);
  });

  it("rejects a non-admin (403)", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "x@y.z" }));
    mockedAdmin.mockReturnValue(adminClient({ role: undefined }));
    expect((await run({ text: "x" })).status).toBe(403);
  });

  it("rejects a missing text body (400)", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(adminClient({ role: "events_admin" }));
    expect((await run({}).then((r) => r.status))).toBe(400);
  });

  it("surfaces parse errors and sends only valid normalized rows to the RPC", async () => {
    let captured: { p_rows: unknown[] } | null = null;
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(
      adminClient({
        role: "events_admin",
        rpcResult: { data: [{ index: 0, status: "inserted" }], error: null },
        onRpc: (a) => (captured = a),
      })
    );
    const text = "Alice, CH, 078 123 45 67, alice@x.ch\nNoContactGuy";
    const res = await run({ text });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(captured!.p_rows).toEqual([
      { name: "Alice", email: "alice@x.ch", phone_e164: "+41781234567" },
    ]);
    expect(json.counts).toEqual({ inserted: 1, merged: 0, errors: 1 });
    expect(
      json.rows.some((r: { reason?: string }) => /phone or an email/i.test(r.reason ?? ""))
    ).toBe(true);
  });

  it("reports an unknown country code as a per-row error (no RPC row)", async () => {
    let called = false;
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(
      adminClient({ role: "events_admin", onRpc: () => (called = true) })
    );
    const res = await run({ text: "Bob, XX, 0612345678" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.counts.errors).toBe(1);
    expect(json.rows[0].reason).toMatch(/country/i);
    expect(called).toBe(false); // nothing valid to import
  });

  it("reports a phone that won't normalize as a per-row error", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(adminClient({ role: "events_admin" }));
    const res = await run({ text: "Carol, CH, 12" });
    const json = await res.json();
    expect(json.counts.errors).toBe(1);
    expect(json.rows[0].reason).toMatch(/invalid phone/i);
  });

  it("returns 500 when the import RPC throws", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(
      adminClient({
        role: "events_admin",
        rpcResult: { data: null, error: { message: "boom" } },
      })
    );
    expect((await run({ text: "Dave, CH, 078 123 45 67" })).status).toBe(500);
  });

  it("returns 404 when the RPC reports the event is not found", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(
      adminClient({
        role: "events_admin",
        rpcResult: {
          data: [{ index: 0, status: "error", message: "Event not found" }],
          error: null,
        },
      })
    );
    expect((await run({ text: "Eve, CH, 078 123 45 67" })).status).toBe(404);
  });

  it("reports partial success counts (inserted + merged + parse error)", async () => {
    mockedServer.mockResolvedValue(authClient({ email: "a@admin.ch" }));
    mockedAdmin.mockReturnValue(
      adminClient({
        role: "events_admin",
        rpcResult: {
          data: [
            { index: 0, status: "inserted" },
            { index: 1, status: "merged" },
          ],
          error: null,
        },
      })
    );
    const text =
      "Frank, CH, 078 123 45 67\nGina, FR, 06 12 34 56 78, gina@x.fr\nBadRowNoContact";
    const json = await (await run({ text })).json();
    expect(json.counts).toEqual({ inserted: 1, merged: 1, errors: 1 });
  });
});
