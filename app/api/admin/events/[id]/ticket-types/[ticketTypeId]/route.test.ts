import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// Real normalizeTicketType (pure; covered by lib/events/ticket-types.test.ts).

import { PATCH, DELETE } from "@/app/api/admin/events/[id]/ticket-types/[ticketTypeId]/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type Cfg = {
  admins?: { id: string; role: string }[];
  // event_ticket_types row returned by the scoped existence check (null = 404). PATCH
  // now loads the stored values too, so a partial body can merge over them.
  existing?:
    | {
        id: string;
        archived_at: string | null;
        title?: string;
        price_member?: number | null;
        price_non_member?: number | null;
        invite_price?: number | null;
        counts_as_seat?: boolean;
        is_child?: boolean;
      }
    | null;
  event?: { visibility: string } | null;
  activeCount?: number; // active types for the last-active guard
  itemRefs?: number; // event_registration_items referencing the type
  waitlistRefs?: number; // event_waitlist rows referencing the type
  capture?: { archived?: boolean; deleted?: boolean; updated?: Record<string, unknown> };
};

function adminClient(cfg: Cfg) {
  const capture = cfg.capture ?? (cfg.capture = {});
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      let isHeadCount = false;
      let isDelete = false;
      let isUpdate = false;
      c.select = (_sel?: unknown, opts?: { head?: boolean }) => {
        if (opts?.head) isHeadCount = true;
        return c;
      };
      c.eq = () => c;
      c.is = () => c;
      c.limit = () => c;
      c.delete = () => {
        isDelete = true;
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        isUpdate = true;
        if (payload.archived_at) capture.archived = true;
        else capture.updated = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "events") return { data: cfg.event ?? { visibility: "public" }, error: null };
        return { data: cfg.existing ?? null, error: null }; // event_ticket_types existence check
      };
      c.single = async () => ({ data: { id: cfg.existing?.id, archived_at: null }, error: null });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: cfg.admins ?? [], error: null });
        if (isDelete) {
          capture.deleted = true;
          return resolve({ error: null });
        }
        if (isUpdate) return resolve({ error: null });
        if (isHeadCount) {
          const count =
            table === "event_registration_items"
              ? cfg.itemRefs ?? 0
              : table === "event_waitlist"
                ? cfg.waitlistRefs ?? 0
                : cfg.activeCount ?? 2; // event_ticket_types active count
          return resolve({ count, error: null });
        }
        return resolve({ data: null, error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

function del(eventId = "evt-1", ticketTypeId = "tt-1") {
  const r = new Request("http://localhost/x", { method: "DELETE" });
  return DELETE(r as never, { params: Promise.resolve({ id: eventId, ticketTypeId }) });
}
function patch(body: unknown, eventId = "evt-1", ticketTypeId = "tt-1") {
  const r = new Request("http://localhost/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(r as never, { params: Promise.resolve({ id: eventId, ticketTypeId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("DELETE ticket type — archive vs delete, last-type guard, IDOR", () => {
  it("401s unauthenticated, 403s non-admin", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({ existing: { id: "tt-1", archived_at: null } }));
    expect((await del()).status).toBe(401);

    mockedCreateClient.mockResolvedValue(sessionClient({ email: "x@x.com" }));
    mockedAdmin.mockReturnValue(adminClient({ admins: [], existing: { id: "tt-1", archived_at: null } }));
    expect((await del()).status).toBe(403);
  });

  it("404s a ticket type belonging to another event (IDOR scope)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, existing: null }));
    expect((await del()).status).toBe(404);
  });

  it("400s deleting the last active type", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ admins: superAdmin, existing: { id: "tt-1", archived_at: null }, activeCount: 1 })
    );
    expect((await del()).status).toBe(400);
  });

  it("archives (not deletes) a type referenced by registration items", async () => {
    const cfg: Cfg = { admins: superAdmin, existing: { id: "tt-1", archived_at: null }, activeCount: 3, itemRefs: 2 };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(true);
    expect(cfg.capture?.archived).toBe(true);
    expect(cfg.capture?.deleted).toBeUndefined();
  });

  it("archives a type referenced only by a waitlist entry", async () => {
    const cfg: Cfg = { admins: superAdmin, existing: { id: "tt-1", archived_at: null }, activeCount: 3, waitlistRefs: 1 };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(true);
  });

  it("hard-deletes an unreferenced, non-last type", async () => {
    const cfg: Cfg = { admins: superAdmin, existing: { id: "tt-1", archived_at: null }, activeCount: 3, itemRefs: 0, waitlistRefs: 0 };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    expect(cfg.capture?.deleted).toBe(true);
    expect(cfg.capture?.archived).toBeUndefined();
  });
});

describe("PATCH ticket type — IDOR + update", () => {
  it("404s a type belonging to another event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, existing: null }));
    const res = await patch({ title: "Standard", price_member: 80, price_non_member: 120 });
    expect(res.status).toBe(404);
  });

  it("403s a non-admin", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: [], existing: { id: "tt-1", archived_at: null } }));
    const res = await patch({ title: "Standard", price_member: 80 });
    expect(res.status).toBe(403);
  });

  it("preserves is_child (and counts_as_seat) when a partial body omits them", async () => {
    // The Settings tab saves only the guest price — title/prices/counts_as_seat/
    // invite_price, with no is_child. A child ticket type must stay flagged, or
    // check-in stops offering the party's kids.
    const cfg: Cfg = {
      admins: superAdmin,
      event: { visibility: "members_only" },
      existing: {
        id: "tt-1",
        archived_at: null,
        title: "Asado Kids",
        price_member: 25,
        price_non_member: null,
        invite_price: null,
        counts_as_seat: true,
        is_child: true,
      },
    };
    mockedAdmin.mockReturnValue(adminClient(cfg));
    const res = await patch({
      title: "Asado Kids",
      price_member: 25,
      price_non_member: null,
      counts_as_seat: true,
      invite_price: 30,
    });
    expect(res.status).toBe(200);
    // The omitted is_child is taken from the stored row, not reset to false.
    expect(cfg.capture?.updated?.is_child).toBe(true);
    expect(cfg.capture?.updated?.invite_price).toBe(30);
  });
});
