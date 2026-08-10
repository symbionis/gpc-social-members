import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { PATCH } from "@/app/api/admin/events/[id]/waitlist/[waitlistId]/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type Reg = { waitlist_entry_id: string | null; email: string; status: string };

type Cfg = {
  admins?: { id: string; role: string }[];
  entry?: { id: string; email: string } | null; // event_waitlist existence check
  ticketType?: { id: string; archived_at: string | null } | null;
  registrations?: Reg[]; // event_registrations rows for THIS event, any status
  capture?: { updated?: Record<string, unknown> };
  updateFails?: boolean;
};

function adminClient(cfg: Cfg) {
  const capture = cfg.capture ?? (cfg.capture = {});
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      let isUpdate = false;
      let statusFilter: string[] | null = null;
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.in = (col: string, values: string[]) => {
        if (col === "status") statusFilter = values;
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        isUpdate = true;
        capture.updated = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_waitlist") {
          if (isUpdate) {
            return {
              data: cfg.updateFails
                ? null
                : {
                    id: cfg.entry?.id,
                    name: "Test",
                    email: capture.updated?.email ?? cfg.entry?.email,
                    ticket_type_id: capture.updated?.ticket_type_id,
                    quantity: capture.updated?.quantity,
                    offered_at: null,
                    offer_sent_count: 0,
                  },
              error: cfg.updateFails ? { message: "boom" } : null,
            };
          }
          return { data: cfg.entry ?? null, error: null };
        }
        if (table === "event_ticket_types") {
          return { data: cfg.ticketType ?? null, error: null };
        }
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: cfg.admins ?? [], error: null });
        if (table === "event_registrations") {
          const rows = (cfg.registrations ?? []).filter(
            (r) => !statusFilter || statusFilter.includes(r.status)
          );
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: null, error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const superAdmin = [{ id: "a1", role: "super_admin" }];

function patch(body: unknown, eventId = "evt-1", waitlistId = "wl-1") {
  const r = new Request("http://localhost/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(r as never, { params: Promise.resolve({ id: eventId, waitlistId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
});

describe("PATCH /admin/events/[id]/waitlist/[waitlistId] — repair an entry", () => {
  it("updates ticket type + quantity for a live type and returns success", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 3 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.entry.quantity).toBe(3);
    expect(json.entry.ticket_type_id).toBe("tt-1");
  });

  it("rejects a ticket type belonging to another event", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: null, // scoped lookup found nothing
      })
    );
    const res = await patch({ ticket_type_id: "tt-other-event", quantity: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects an archived ticket type", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: "2026-01-01T00:00:00Z" },
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects quantity 0 and quantity 11", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin }));
    expect((await patch({ ticket_type_id: "tt-1", quantity: 0 })).status).toBe(400);
    expect((await patch({ ticket_type_id: "tt-1", quantity: 11 })).status).toBe(400);
  });

  it("401s unauthenticated, 403s a non-admin session", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({}));
    expect((await patch({ ticket_type_id: "tt-1", quantity: 2 })).status).toBe(401);

    mockedCreateClient.mockResolvedValue(sessionClient({ email: "x@x.com" }));
    mockedAdmin.mockReturnValue(adminClient({ admins: [] }));
    expect((await patch({ ticket_type_id: "tt-1", quantity: 2 })).status).toBe(403);
  });

  it("404s a waitlist entry belonging to another event (IDOR scope)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, entry: null }));
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2 });
    expect(res.status).toBe(404);
  });

  it("the returned entry payload contains no offer_token value", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2 });
    const json = await res.json();
    expect(json.entry.offer_token).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("offer_token");
  });

  it("updates the email on an unredeemed entry", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "old@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
        registrations: [],
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2, email: "new@x.com" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry.email).toBe("new@x.com");
  });

  it("rejects an email change on an entry redeemed via the direct waitlist_entry_id link", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
        registrations: [{ waitlist_entry_id: "wl-1", email: "someone-else@x.com", status: "paid" }],
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2, email: "new@x.com" });
    expect(res.status).toBe(400);
  });

  it("rejects an email change when the entry's email matches a live (paid/free) registration for the event", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
        registrations: [{ waitlist_entry_id: null, email: "a@x.com", status: "free" }],
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2, email: "new@x.com" });
    expect(res.status).toBe(400);
  });

  it("a pending (not yet paid) registration does not count as redeemed — email change succeeds", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
        registrations: [{ waitlist_entry_id: "wl-1", email: "a@x.com", status: "pending" }],
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2, email: "new@x.com" });
    expect(res.status).toBe(200);
  });

  it("rejects a malformed email", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        ticketType: { id: "tt-1", archived_at: null },
        registrations: [],
      })
    );
    const res = await patch({ ticket_type_id: "tt-1", quantity: 2, email: "not-an-email" });
    expect(res.status).toBe(400);
  });
});
