import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/checkin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/checkin")>();
  return { ...actual, checkInChildren: vi.fn() };
});

import { POST } from "@/app/api/events/[id]/check-in/children/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkInChildren } from "@/lib/events/checkin";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedCheckIn = vi.mocked(checkInChildren);

function eventClient(event: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: event, error: null });
  return { from: () => chain } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request(`http://localhost/api/events/${eventId}/check-in/children`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const ID_A = "11111111-2222-3333-4444-555555555555";
const ID_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(eventClient({ id: "evt-1", is_published: true }));
  mockedCheckIn.mockResolvedValue(2);
});

describe("POST /api/events/[id]/check-in/children", () => {
  it("rejects a missing attendeeIds array", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(mockedCheckIn).not.toHaveBeenCalled();
  });

  it("rejects when no valid uuid is supplied", async () => {
    const res = await post({ attendeeIds: ["nope", 5] });
    expect(res.status).toBe(400);
    expect(mockedCheckIn).not.toHaveBeenCalled();
  });

  it("404s an unpublished / unknown event", async () => {
    mockedAdmin.mockReturnValue(eventClient(null));
    const res = await post({ attendeeIds: [ID_A] });
    expect(res.status).toBe(404);
    expect(mockedCheckIn).not.toHaveBeenCalled();
  });

  it("checks in the valid ids and returns the count", async () => {
    const res = await post({ attendeeIds: [ID_A, ID_B, "bad"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checkedIn: 2 });
    expect(mockedCheckIn).toHaveBeenCalledWith("evt-1", [ID_A, ID_B]);
  });
});
