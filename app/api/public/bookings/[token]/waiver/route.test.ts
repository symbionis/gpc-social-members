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
  /** Rows the guarded UPDATE reports back. `[]` = matched nothing. */
  updated?: unknown[];
  /** Error for the guarded UPDATE. */
  updateError?: unknown;
  /** Error for a named read, to prove a DB fault is a 500 and not a 404/409. */
  failRead?: "regByToken" | "self" | "regById" | "ticket";
  /** waiver_accepted_at seen by the re-read after a zero-row update. */
  reReadAcceptedAt?: string | null;
}

let lastUpdate: Record<string, unknown> | null = null;
// Every filter the UPDATE carried, as "op:column". The guards that scope the write live here,
// so they have to be observable — with `eq`/`in` as no-ops, dropping .eq("registration_id")
// let any token sign a ticket in another booking with the suite still green.
let updateFilters: string[] = [];

function adminClient(opts: Opts) {
  let selfServed = false;
  let ticketReads = 0;
  // The route looks registrations up TWICE on the household path: first by manage_token
  // (misses, which is what sends it down the per-ticket branch), then by id.
  let regLookups = 0;
  return {
    from: (table: string) => {
      const c: Record<string, unknown> & { _upd?: boolean } = {};
      const note = (op: string) => (col: string) => {
        if (c._upd) updateFilters.push(`${op}:${col}`);
        return c;
      };
      c.select = () => c;
      c.eq = note("eq");
      c.in = note("in");
      c.is = note("is");
      c.limit = () => c;
      c.update = (payload: Record<string, unknown>) => {
        c._upd = true;
        lastUpdate = payload;
        // The update resolves directly (no maybeSingle) — mirror the route's await.
        (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
          resolve({
            data: opts.updated ?? [{ id: TICKET }],
            error: opts.updateError ?? null,
          });
        return c;
      };
      c.maybeSingle = async () => {
        if (table === "event_registrations") {
          regLookups += 1;
          const byToken =
            "reg" in opts ? opts.reg : { id: "reg", status: "paid", email: "ana@x.ch" };
          if (regLookups === 1 && opts.failRead === "regByToken") {
            return { data: null, error: { message: "boom" } };
          }
          // A null `reg` means "this token is a per-ticket one" — the by-id lookup that
          // follows must still find the booking, or the route 404s before the real assertion.
          if (byToken === null && regLookups > 1) {
            if (opts.failRead === "regById") return { data: null, error: { message: "boom" } };
            return { data: { id: "reg", status: "paid", email: "lead@x.ch" }, error: null };
          }
          return { data: byToken, error: null };
        }
        if (table === "tickets") {
          // First tickets lookup is the per-ticket token resolution; the next is the target;
          // a third is the re-read the route does when the UPDATE matched no row.
          if (!selfServed && "self" in opts) {
            selfServed = true;
            if (opts.failRead === "self") return { data: null, error: { message: "boom" } };
            return { data: opts.self, error: null };
          }
          ticketReads += 1;
          if (ticketReads > 1) {
            return { data: { waiver_accepted_at: opts.reReadAcceptedAt ?? null }, error: null };
          }
          if (opts.failRead === "ticket") return { data: null, error: { message: "boom" } };
          return {
            data:
              "ticket" in opts
                ? opts.ticket
                : {
                    id: TICKET,
                    name: "Ana Ruiz",
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
    expect(updateFilters).toContain("is:waiver_accepted_at");
  });

  // The read authorised this ticket, in this booking, live and issued/claimed. The write has
  // to re-assert all of it: cancel is reachable from the same page in another tab, so the row
  // can leave that set between the two statements. Drop any one of these and the waiver can be
  // stamped onto a seat that is no longer signable — or onto one in a different booking.
  it.each([
    ["eq:id", "the ticket itself"],
    ["eq:registration_id", "the booking it was authorised against"],
    ["is:released_at", "still live"],
    ["in:slot_status", "still issued or claimed"],
    ["is:cancellation_status", "not cancelled mid-request"],
  ])("scopes the update on %s (%s)", async (filter) => {
    await post(good);
    expect(updateFilters).toContain(filter);
  });

  it("is idempotent: an already-signed ticket is not re-stamped", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          name: "Ana Ruiz",
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
          name: "Ana Ruiz",
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
          name: "Ana Ruiz",
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
          name: "Ana Ruiz",
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

  // The lead's registration token used to skip the email check entirely, so whoever booked
  // could record an acceptance against every guest in the party — people who never opened the
  // page. Cancel and convert DO give the lead that reach, and this route was modelled on them;
  // paying for a seat is not the same as attesting on behalf of the person in it.
  it("refuses the LEAD signing a ticket on someone else's email", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: "reg", status: "paid", email: "lead@x.ch" },
        ticket: {
          id: TICKET,
          name: "Ana Ruiz",
          email: "guest@x.ch",
          waiver_accepted_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  it("lets the LEAD sign their own ticket", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: "reg", status: "paid", email: "Lead@X.ch " },
        ticket: {
          id: TICKET,
          name: "Lena Ord",
          email: "lead@x.ch",
          waiver_accepted_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(lastUpdate).toMatchObject({ waiver_version: WAIVER_VERSION });
  });

  // A waiver attests to a person. An unnamed seat can still be handed to anyone, and naming it
  // clears the acceptance anyway (fill_ticket), so signing one is a record that cannot survive.
  it("refuses an unnamed ticket", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        ticket: {
          id: TICKET,
          name: "   ",
          email: "ana@x.ch",
          waiver_accepted_at: null,
          cancellation_status: null,
        },
      })
    );
    const res = await post(good);
    expect(res.status).toBe(409);
    expect(lastUpdate).toBeNull();
  });

  // Zero rows updated is NOT success. Without the rowcount check the guest is told they
  // signed, the card flips to "Waiver signed", and no row was ever written.
  it("500s when the update matches no row and the ticket is still unsigned", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAdmin.mockReturnValue(adminClient({ updated: [], reReadAcceptedAt: null }));
    const res = await post(good);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("acceptance") });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ...but the one benign cause of zero rows — another tab signed first — still reports the
  // truth, and reports it as ALREADY so the two are distinguishable.
  it("reports already-signed when the race was lost but the row is genuinely signed", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ updated: [], reReadAcceptedAt: "2026-08-01T10:00:00Z" })
    );
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
  });

  it("500s rather than reporting success when the update itself errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAdmin.mockReturnValue(adminClient({ updateError: { message: "boom" } }));
    const res = await post(good);
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  // A database fault is OUR problem. Reporting it as "Booking not found" tells the guest their
  // emailed link is broken, and leaves an outage looking like a spike of user error.
  it.each([
    ["regByToken", "the registration lookup by token"],
    ["ticket", "the target ticket lookup"],
  ] as const)("500s, not 404/409, when %s fails (%s)", async (failRead, _what) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAdmin.mockReturnValue(adminClient({ failRead }));
    const res = await post(good);
    expect(res.status).toBe(500);
    expect(lastUpdate).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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
