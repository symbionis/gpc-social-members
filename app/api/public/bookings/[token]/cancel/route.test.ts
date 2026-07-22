import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/cancel/route";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);
const TICKET = "33333333-3333-3333-3333-333333333333";

interface Opts {
  reg?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
  updated?: Record<string, unknown> | null;
}

// Lead flow: the path token resolves a registration (no per-ticket self lookup). The chain
// object returns the reg for event_registrations, the ticket for a tickets SELECT, and the
// update result once `.update()` has been called on it.
let lastUpdate: Record<string, unknown> | null = null;

function adminClient(opts: Opts) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> & { _upd?: boolean } = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.is = () => c;
      c.limit = () => c;
      c.update = (payload: Record<string, unknown>) => {
        c._upd = true;
        lastUpdate = payload;
        return c;
      };
      c.maybeSingle = async () => {
        if (c._upd) return { data: "updated" in opts ? opts.updated : { id: TICKET }, error: null };
        if (table === "event_registrations")
          return { data: "reg" in opts ? opts.reg : { id: "reg", status: "paid" }, error: null };
        if (table === "tickets")
          return {
            data:
              "ticket" in opts
                ? opts.ticket
                : {
                    id: TICKET,
                    email: "h@x.com",
                    slot_status: "claimed",
                    checked_in_at: null,
                    released_at: null,
                    cancellation_status: null,
                  },
            error: null,
          };
        return { data: null, error: null };
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(ticketId: string = TICKET, token = "lead-token") {
  const r = new Request(`http://localhost/api/public/bookings/${token}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId }),
  });
  return POST(r as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastUpdate = null;
});

describe("POST booking cancel (U14)", () => {
  it("cancels a live claimed ticket and flips its status to requested", async () => {
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(lastUpdate).toMatchObject({ cancellation_status: "requested" });
    expect(lastUpdate?.cancellation_requested_at).toBeTruthy();
  });

  it("rejects an invalid ticket id", async () => {
    mockedAdmin.mockReturnValue(adminClient({}));
    const res = await post("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("404s when the token matches no booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: null, ticket: null }));
    const res = await post();
    expect(res.status).toBe(404);
  });

  it("409s a checked-in ticket without updating it", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          email: "h@x.com",
          slot_status: "claimed",
          checked_in_at: "2026-01-01T00:00:00Z",
          released_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post();
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  it("is idempotent — an already-cancelled ticket is a no-op success (R22)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          email: "h@x.com",
          slot_status: "claimed",
          checked_in_at: null,
          released_at: null,
          cancellation_status: "requested",
        },
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyCancelled: true });
    expect(lastUpdate).toBeNull();
  });

  it("409s when the ticket isn't in this booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ ticket: null }));
    const res = await post();
    expect(res.status).toBe(409);
  });
});
