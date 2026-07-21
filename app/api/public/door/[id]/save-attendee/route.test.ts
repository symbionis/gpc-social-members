import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/save-attendee/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);

type Row = Record<string, unknown> | null;

// Table-aware mock. maybeSingle resolves the looked-up row per table; the edit path
// awaits the update builder via `then`. The fill path delegates to the claim_ticket
// RPC — `rpc` returns opts.claim.
function adminClient(opts: { existing?: Row; reg?: Row; claim?: Record<string, unknown> }) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.in = () => c;
      c.limit = () => c;
      c.update = () => c;
      c.maybeSingle = async () => {
        if (table === "tickets") return { data: opts.existing ?? null, error: null };
        if (table === "event_registrations") return { data: opts.reg ?? null, error: null };
        return { data: null, error: null };
      };
      // Edit path awaits the update builder.
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: [{ id: "edited" }], error: null });
      return c;
    },
    rpc: async (_fn: string, _args: unknown) => ({ data: opts.claim ?? null, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

const UID = "11111111-2222-3333-4444-555555555555";
const REG = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const TYPE = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

function post(body: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/save-attendee`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedAdmin.mockReturnValue(adminClient({}));
});

describe("POST /api/public/door/[id]/save-attendee", () => {
  it("404s an unknown / unpublished event", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post({ name: "Ann" });
    expect(res.status).toBe(404);
    expect(mockedAdmin).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const res = await post({ attendeeId: UID });
    expect(res.status).toBe(400);
  });

  it("edits an existing adult slot (name + email)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ existing: { id: UID, is_child: false, checked_in_at: null } })
    );
    const res = await post({ attendeeId: UID, name: "Ann Lead", email: "ann@x.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: false });
  });

  it("rejects editing an adult slot down to no contact", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ existing: { id: UID, is_child: false, checked_in_at: null } })
    );
    const res = await post({ attendeeId: UID, name: "Ann" });
    expect(res.status).toBe(400);
  });

  it("covers R6: rejects editing a former child-type slot down to no contact (no more exemption)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ existing: { id: UID, is_child: true, checked_in_at: null } })
    );
    const res = await post({ attendeeId: UID, name: "Kid" });
    expect(res.status).toBe(400);
  });

  it("still allows editing a checked-in slot's name with no contact (arrived guest exemption unrelated to is_child)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ existing: { id: UID, is_child: true, checked_in_at: "2026-07-21T18:00:00Z" } })
    );
    const res = await post({ attendeeId: UID, name: "Kid Corrected" });
    expect(res.status).toBe(200);
  });

  it("fills an open adult slot by flipping an issued ticket (claim_ticket → claimed)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: REG },
        claim: { status: "claimed", attendee_id: "flipped", already: false },
      })
    );
    const res = await post({
      registrationId: REG,
      ticketTypeId: TYPE,
      name: "Bo Guest",
      phone: "+41781234567",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: true, attendeeId: "flipped" });
  });

  it("409s when the ticket type is already full for the party (claim_ticket → type_full)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ reg: { id: REG }, claim: { status: "type_full" } })
    );
    const res = await post({
      registrationId: REG,
      ticketTypeId: TYPE,
      name: "Bo",
      phone: "+41781234567",
    });
    expect(res.status).toBe(409);
  });

  it("fills a child slot with a name only (claim_ticket allows contactless child)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: REG },
        claim: { status: "claimed", attendee_id: "kid", already: false },
      })
    );
    const res = await post({ registrationId: REG, ticketTypeId: TYPE, name: "Sofia" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: true });
  });

  it("404s when the party is not on this event", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: null }));
    const res = await post({ registrationId: REG, ticketTypeId: TYPE, name: "Bo", phone: "+41781234567" });
    expect(res.status).toBe(404);
  });
});
