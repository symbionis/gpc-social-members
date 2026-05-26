import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/reminder-schedule", () => ({
  validateReminderSchedule: () => ({ ok: true, value: [] }),
}));

import { POST } from "@/app/api/admin/events/create/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type RpcCapture = { name?: string; args?: { p_event: unknown; p_types: unknown } };

function adminClient(admins: { id: string; role: string }[], rpc: RpcCapture) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: admins, error: null });
      return c;
    },
    rpc: (name: string, args: { p_event: unknown; p_types: unknown }) => {
      rpc.name = name;
      rpc.args = args;
      return Promise.resolve({ data: "evt-new", error: null });
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

function req(body: unknown) {
  const r = new Request("http://localhost/api/admin/events/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(r as never);
}

const baseEvent = {
  title: "Polo Brunch",
  event_type_id: "type-1",
  start_date: "2026-06-15",
  visibility: "public",
  registration_enabled: true,
};

let rpc: RpcCapture;

beforeEach(() => {
  vi.clearAllMocks();
  rpc = {};
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedAdmin.mockReturnValue(adminClient(superAdmin, rpc));
});

describe("POST /api/admin/events/create", () => {
  it("creates event + types atomically via the RPC", async () => {
    const res = await req({
      ...baseEvent,
      ticket_types: [
        { title: "Standard", price_member: "80", price_non_member: "120", counts_as_seat: true },
        { title: "Kids", price_member: "40", price_non_member: "60", counts_as_seat: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(rpc.name).toBe("create_event_with_ticket_types");
    const types = rpc.args?.p_types as { title: string; price_member: number | null; sort_order: number }[];
    expect(types).toHaveLength(2);
    expect(types[0]).toMatchObject({ title: "Standard", price_member: 80, price_non_member: 120, sort_order: 0 });
    expect(types[1]).toMatchObject({ title: "Kids", sort_order: 1 });
  });

  it("forces non-member price null on a members-only event (invite price is valid there)", async () => {
    await req({
      ...baseEvent,
      visibility: "members_only",
      ticket_types: [{ title: "Standard", price_member: "80", price_non_member: "120", invite_price: "90" }],
    });
    const types = rpc.args?.p_types as { price_non_member: number | null; invite_price: number | null }[];
    expect(types[0].price_non_member).toBeNull(); // members-only never carries a non-member price
    expect(types[0].invite_price).toBe(90); // invite price is permitted on members-only types
  });

  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    const res = await req({ ...baseEvent, ticket_types: [{ title: "Standard", price_member: "80", price_non_member: "120" }] });
    expect(res.status).toBe(401);
    expect(rpc.name).toBeUndefined();
  });

  it("403s a non-admin", async () => {
    mockedAdmin.mockReturnValue(adminClient([], rpc));
    const res = await req({ ...baseEvent, ticket_types: [{ title: "Standard", price_member: "80", price_non_member: "120" }] });
    expect(res.status).toBe(403);
    expect(rpc.name).toBeUndefined();
  });

  it("400s when no ticket types are provided", async () => {
    const res = await req({ ...baseEvent, ticket_types: [] });
    expect(res.status).toBe(400);
    expect(rpc.name).toBeUndefined();
  });

  it("400s when registration is enabled but a type lacks a member price", async () => {
    const res = await req({
      ...baseEvent,
      ticket_types: [{ title: "Standard", price_member: "", price_non_member: "120" }],
    });
    expect(res.status).toBe(400);
    expect(rpc.name).toBeUndefined();
  });

  it("400s when a public event's type lacks a non-member price", async () => {
    const res = await req({
      ...baseEvent,
      ticket_types: [{ title: "Standard", price_member: "80", price_non_member: "" }],
    });
    expect(res.status).toBe(400);
  });
});
