import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/search/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveDoorEvent);

type Row = Record<string, unknown>;

function adminClient(opts: { regs: Row[]; atts: Row[] }) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({
          data: table === "event_registrations" ? opts.regs : opts.atts,
          error: null,
        });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(query: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/search`, {
    method: "POST",
    body: JSON.stringify({ query }),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

const regs: Row[] = [
  { id: "r1", name: "Diego García", email: "d@x.com", phone_e164: "+41781111111", quantity: 6, self_reg_token: "tok1" },
  { id: "r2", name: "Ann Lévigne", email: "a@x.com", phone_e164: null, quantity: 2, self_reg_token: "tok2" },
];
const atts: Row[] = [
  { id: "a1", registration_id: "r1", name: "Diego García", email: "d@x.com", phone_e164: "+41781111111", is_lead: true, waiver_accepted_at: null, checked_in_at: null },
  { id: "a2", registration_id: "r1", name: "Bob Guest", email: "bob@x.com", phone_e164: null, is_lead: false, waiver_accepted_at: "2026-06-01T09:00:00Z", checked_in_at: null },
  { id: "a3", registration_id: "r2", name: "Ann Lévigne", email: "a@x.com", phone_e164: null, is_lead: true, waiver_accepted_at: null, checked_in_at: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "Season Open", startDate: null });
  mockedAdmin.mockReturnValue(adminClient({ regs, atts }));
});

describe("POST /api/public/door/[id]/search", () => {
  it("404s an unknown / unpublished event without touching the roster", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post("diego");
    expect(res.status).toBe(404);
    expect(mockedAdmin).not.toHaveBeenCalled();
  });

  it("returns no parties for a short query (no bulk dump)", async () => {
    const res = await post("d");
    expect(res.status).toBe(200);
    expect((await res.json()).parties).toEqual([]);
  });

  it("matches a party by the lead's name with correct fill and token", async () => {
    const res = await post("diego");
    const { parties } = await res.json();
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      registrationId: "r1",
      leadName: "Diego García",
      quantity: 6,
      claimedCount: 2,
      remaining: 4,
      complete: false,
      selfRegToken: "tok1",
    });
    expect(parties[0].guests.map((g: { name: string }) => g.name)).toEqual(["Bob Guest"]);
  });

  it("matches a party by a guest's contact", async () => {
    const res = await post("bob@x.com");
    const { parties } = await res.json();
    expect(parties).toHaveLength(1);
    expect(parties[0].registrationId).toBe("r1");
  });

  it("matches a different party by lead name with its own fill", async () => {
    const res = await post("lévigne");
    const { parties } = await res.json();
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ registrationId: "r2", claimedCount: 1, quantity: 2, remaining: 1 });
  });

  it("returns an empty list when nothing matches", async () => {
    const res = await post("nobody");
    expect((await res.json()).parties).toEqual([]);
  });
});
