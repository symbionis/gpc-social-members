import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/registration", () => ({
  generateSelfRegToken: vi.fn(() => "selfregtoken-test"),
}));
vi.mock("@/lib/email/event-waitlist-offer", () => ({ sendWaitlistOffer: vi.fn() }));

import { POST, DELETE } from "@/app/api/admin/events/[id]/waitlist/[waitlistId]/offer/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWaitlistOffer } from "@/lib/email/event-waitlist-offer";

const mockedCreateClient = vi.mocked(createClient);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedSendOffer = vi.mocked(sendWaitlistOffer);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

type Reg = { waitlist_entry_id: string | null; email: string; status: string };

type Cfg = {
  admins?: { id: string; role: string }[];
  entry?: {
    id: string;
    email: string;
    ticket_type_id?: string | null;
    quantity?: number | null;
    offer_token?: string | null;
    offer_sent_count?: number;
  } | null;
  event?: { id: string; registration_enabled: boolean } | null;
  ticketType?: { title: string; archived_at: string | null; counts_as_seat: boolean } | null;
  registrations?: Reg[];
  capture?: { updated?: Record<string, unknown> };
  updateFails?: boolean;
};

function adminClient(cfg: Cfg) {
  const capture = cfg.capture ?? (cfg.capture = {});
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      let statusFilter: string[] | null = null;
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.in = (col: string, values: string[]) => {
        if (col === "status") statusFilter = values;
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        capture.updated = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_waitlist") {
          if (capture.updated) {
            return {
              data: cfg.updateFails ? null : { id: cfg.entry?.id, ...capture.updated },
              error: cfg.updateFails ? { message: "boom" } : null,
            };
          }
          return { data: cfg.entry ?? null, error: null };
        }
        if (table === "events") {
          return { data: cfg.event ?? null, error: null };
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

const superAdmin = [{ id: "admin-1", role: "super_admin" }];
const liveType = { title: "Standard", archived_at: null, counts_as_seat: true };
const openEvent = { id: "evt-1", registration_enabled: true };

function offer(eventId = "evt-1", waitlistId = "wl-1") {
  const r = new Request("http://localhost/x", { method: "POST" });
  return POST(r as never, { params: Promise.resolve({ id: eventId, waitlistId }) });
}
function withdraw(eventId = "evt-1", waitlistId = "wl-1") {
  const r = new Request("http://localhost/x", { method: "DELETE" });
  return DELETE(r as never, { params: Promise.resolve({ id: eventId, waitlistId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.com" }));
  mockedSendOffer.mockResolvedValue({ success: true });
});

describe("POST offer/resend", () => {
  it("mints a token, stamps offer fields, and reports the email result", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2, offer_token: null, offer_sent_count: 0 },
        event: openEvent,
        ticketType: liveType,
        registrations: [],
      })
    );
    const res = await offer();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.email_sent).toBe(true);
    expect(json.offer_sent_count).toBe(1);
    expect(mockedSendOffer).toHaveBeenCalledWith("wl-1");
  });

  it("resend keeps the existing token and increments the send count", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: {
          id: "wl-1",
          email: "a@x.com",
          ticket_type_id: "tt-1",
          quantity: 2,
          offer_token: "already-there",
          offer_sent_count: 3,
        },
        event: openEvent,
        ticketType: liveType,
        registrations: [],
      })
    );
    const res = await offer();
    const json = await res.json();
    expect(json.offer_sent_count).toBe(4);
    // generateSelfRegToken must not have been used to overwrite the existing token.
    const { generateSelfRegToken } = await import("@/lib/events/registration");
    expect(vi.mocked(generateSelfRegToken)).not.toHaveBeenCalled();
  });

  it("401s unauthenticated, 403s a non-admin session", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({}));
    expect((await offer()).status).toBe(401);

    mockedCreateClient.mockResolvedValue(sessionClient({ email: "x@x.com" }));
    mockedAdmin.mockReturnValue(adminClient({ admins: [] }));
    expect((await offer()).status).toBe(403);
  });

  // The public waitlist stores no ticket type; the invitee picks on the offer landing.
  it("offers an entry with a null ticket type", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: null, quantity: 2, offer_token: null, offer_sent_count: 0 },
        event: openEvent,
        registrations: [],
      })
    );
    const res = await offer();
    expect(res.status).toBe(200);
    expect(mockedSendOffer).toHaveBeenCalledWith("wl-1");
  });

  it("rejects an entry whose type is archived", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2 },
        event: openEvent,
        ticketType: { title: "Dinner", archived_at: "2026-01-01T00:00:00Z", counts_as_seat: true },
      })
    );
    expect((await offer()).status).toBe(400);
  });

  it("rejects an entry whose type does not count as a seat", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2 },
        event: openEvent,
        ticketType: { title: "Merch", archived_at: null, counts_as_seat: false },
      })
    );
    expect((await offer()).status).toBe(400);
  });

  it("rejects when registration_enabled is false", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2 },
        event: { id: "evt-1", registration_enabled: false },
        ticketType: liveType,
      })
    );
    expect((await offer()).status).toBe(400);
  });

  it("rejects an already-redeemed entry", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2 },
        event: openEvent,
        ticketType: liveType,
        registrations: [{ waitlist_entry_id: "wl-1", email: "a@x.com", status: "paid" }],
      })
    );
    expect((await offer()).status).toBe(400);
  });

  it("404s an entry belonging to another event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, entry: null }));
    expect((await offer()).status).toBe(404);
  });

  it("persists offer state and reports failure when the email send fails", async () => {
    mockedSendOffer.mockResolvedValue({ success: false, error: "no template" });
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com", ticket_type_id: "tt-1", quantity: 2 },
        event: openEvent,
        ticketType: liveType,
        registrations: [],
      })
    );
    const res = await offer();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.email_sent).toBe(false);
    // The count tracks DELIVERED offers. Bumping it on a failed send made a row read
    // "Offered ×2" for someone who received nothing, and the admin's failure notice is
    // component state that a refresh wipes. Staying at 0 while offered_at is set is
    // what makes an undelivered offer visible on reload.
    expect(json.offer_sent_count).toBe(0);
  });

  it("offering three entries against two free seats succeeds with no warning (R4)", async () => {
    for (const id of ["wl-1", "wl-2", "wl-3"]) {
      mockedAdmin.mockReturnValue(
        adminClient({
          admins: superAdmin,
          entry: { id, email: `${id}@x.com`, ticket_type_id: "tt-1", quantity: 2 },
          event: openEvent,
          ticketType: liveType,
          registrations: [],
        })
      );
      const res = await offer("evt-1", id);
      expect(res.status).toBe(200);
    }
  });
});

describe("DELETE withdraw", () => {
  it("clears the offer token, returning the entry to queued (AE10)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        registrations: [],
      })
    );
    const res = await withdraw();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects withdrawing an already-redeemed entry", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        admins: superAdmin,
        entry: { id: "wl-1", email: "a@x.com" },
        registrations: [{ waitlist_entry_id: "wl-1", email: "a@x.com", status: "paid" }],
      })
    );
    expect((await withdraw()).status).toBe(400);
  });

  it("401s unauthenticated, 403s a non-admin session", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    mockedAdmin.mockReturnValue(adminClient({}));
    expect((await withdraw()).status).toBe(401);

    mockedCreateClient.mockResolvedValue(sessionClient({ email: "x@x.com" }));
    mockedAdmin.mockReturnValue(adminClient({ admins: [] }));
    expect((await withdraw()).status).toBe(403);
  });

  it("404s an entry belonging to another event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ admins: superAdmin, entry: null }));
    expect((await withdraw()).status).toBe(404);
  });
});
