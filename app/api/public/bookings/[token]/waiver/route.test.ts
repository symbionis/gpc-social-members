import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/waiver/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { WAIVER_VERSION } from "@/lib/events/waiver";

const mockedAdmin = vi.mocked(createAdminClient);
const TICKET = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";

interface Opts {
  /** The registration the path token resolves to, or null to force the per-ticket lookup. */
  reg?: Record<string, unknown> | null;
  /** The ticket the per-ticket manage_token resolves to (household caller). */
  self?: Record<string, unknown> | null;
  /** The ticket being signed. */
  ticket?: Record<string, unknown> | null;
}

let lastUpdate: Record<string, unknown> | null = null;
let updateFilters: string[] = [];

function adminClient(opts: Opts) {
  let selfServed = false;
  // The route looks registrations up TWICE on the household path: first by manage_token
  // (misses, which is what sends it down the per-ticket branch), then by id.
  let regLookups = 0;
  return {
    from: (table: string) => {
      const c: Record<string, unknown> & { _upd?: boolean } = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.is = (col: string) => {
        if (c._upd) updateFilters.push(col);
        return c;
      };
      c.limit = () => c;
      c.update = (payload: Record<string, unknown>) => {
        c._upd = true;
        lastUpdate = payload;
        // The update resolves directly (no maybeSingle) — mirror the route's await.
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({ error: null });
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_registrations") {
          regLookups += 1;
          const byToken = "reg" in opts ? opts.reg : { id: "reg", status: "paid" };
          // A null `reg` means "this token is a per-ticket one" — the by-id lookup that
          // follows must still find the booking, or the route 404s before the real assertion.
          if (byToken === null && regLookups > 1) {
            return { data: { id: "reg", status: "paid" }, error: null };
          }
          return { data: byToken, error: null };
        }
        if (table === "tickets") {
          // First tickets lookup is the per-ticket token resolution; the next is the target.
          if (!selfServed && "self" in opts) {
            selfServed = true;
            return { data: opts.self, error: null };
          }
          return {
            data:
              "ticket" in opts
                ? opts.ticket
                : {
                    id: TICKET,
                    email: "ana@x.ch",
                    waiver_accepted_at: null,
                    cancellation_status: null,
                  },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, token = "tok") {
  return POST(
    new Request("http://localhost/api/public/bookings/tok/waiver", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ token }) }
  );
}

const good = { ticketId: TICKET, language: "en", marketingConsent: true };

beforeEach(() => {
  vi.clearAllMocks();
  lastUpdate = null;
  updateFilters = [];
  mockedAdmin.mockReturnValue(adminClient({}));
});

describe("POST /api/public/bookings/[token]/waiver", () => {
  it("stamps the waiver with the SERVER's version, never the client's", async () => {
    const res = await post({ ...good, waiverVersion: "attacker-supplied" });
    expect(res.status).toBe(200);
    expect(lastUpdate).toMatchObject({
      waiver_version: WAIVER_VERSION,
      language: "en",
      marketing_consent: true,
    });
    expect(lastUpdate?.waiver_accepted_at).toBeTruthy();
  });

  // Two tabs, two taps. The guard makes the second a no-op rather than moving the guest onto
  // a fresh timestamp — and, if the text ever changes, onto a version they never read.
  it("guards the update on the waiver still being unsigned", async () => {
    await post(good);
    expect(updateFilters).toContain("waiver_accepted_at");
  });

  it("is idempotent: an already-signed ticket is not re-stamped", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          email: "ana@x.ch",
          waiver_accepted_at: "2026-08-01T10:00:00Z",
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
    expect(lastUpdate).toBeNull();
  });

  it("refuses a cancelled ticket", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          email: "ana@x.ch",
          waiver_accepted_at: null,
          cancellation_status: "requested",
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  // A household link may only sign tickets on its own email. Without this a guest could sign
  // for anyone in the booking, which is the thing per-ticket acceptance exists to prevent.
  it("refuses a ticket belonging to another email in the booking", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: null,
        self: { id: OTHER, registration_id: "reg", email: "ana@x.ch" },
        ticket: {
          id: TICKET,
          email: "someone.else@x.ch",
          waiver_accepted_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  it("allows a household sibling on the same email", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: null,
        self: { id: OTHER, registration_id: "reg", email: "ANA@x.ch " },
        ticket: {
          id: TICKET,
          email: "ana@x.ch",
          waiver_accepted_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(lastUpdate).toMatchObject({ waiver_version: WAIVER_VERSION });
  });

  it("rejects a language it cannot render the waiver in", async () => {
    const res = await post({ ...good, language: "de" });
    expect(res.status).toBe(400);
    expect(lastUpdate).toBeNull();
  });

  it("rejects a malformed ticket id", async () => {
    const res = await post({ ...good, ticketId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("refuses an unconfirmed booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: { id: "reg", status: "pending" } }));
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  it("records a declined marketing consent as declined", async () => {
    await post({ ...good, marketingConsent: false });
    expect(lastUpdate).toMatchObject({ marketing_consent: false });
  });
});
