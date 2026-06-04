import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/save-attendee/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);

type Row = Record<string, unknown> | null;

// Table-aware mock: maybeSingle resolves the looked-up row per table; awaited queries
// (items list, count head, insert, update) resolve via `then`.
function adminClient(opts: {
  existing?: Row;
  reg?: Row;
  type?: Row;
  items?: { quantity: number }[];
  count?: number;
}) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.in = () => c;
      c.limit = () => c;
      c.insert = () => c;
      c.update = () => c;
      c.maybeSingle = async () => {
        if (table === "event_attendees") return { data: opts.existing ?? null, error: null };
        if (table === "event_registrations") return { data: opts.reg ?? null, error: null };
        if (table === "event_ticket_types") return { data: opts.type ?? null, error: null };
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_registration_items") return resolve({ data: opts.items ?? [], error: null });
        // event_attendees awaited: count head OR insert OR update — provide all fields.
        return resolve({ data: [{ id: "new-att" }], count: opts.count ?? 0, error: null });
      };
      return c;
    },
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

  it("fills an open adult slot (create) with a phone", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: REG, status: "free" },
        type: { id: TYPE, is_child: false },
        items: [{ quantity: 3 }],
        count: 1,
      })
    );
    const res = await post({
      registrationId: REG,
      ticketTypeId: TYPE,
      name: "Bo Guest",
      phone: "+41781234567",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: true });
  });

  it("409s when the ticket type is already full for the party", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: REG, status: "free" },
        type: { id: TYPE, is_child: false },
        items: [{ quantity: 2 }],
        count: 2,
      })
    );
    const res = await post({
      registrationId: REG,
      ticketTypeId: TYPE,
      name: "Bo",
      phone: "+41781234567",
    });
    expect(res.status).toBe(409);
  });

  it("fills a child slot with a name only (no contact needed)", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        reg: { id: REG, status: "free" },
        type: { id: TYPE, is_child: true },
        items: [{ quantity: 2 }],
        count: 0,
      })
    );
    const res = await post({ registrationId: REG, ticketTypeId: TYPE, name: "Sofia" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: true });
  });
});
