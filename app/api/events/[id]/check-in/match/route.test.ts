import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/checkin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/checkin")>();
  return { ...actual, matchContact: vi.fn() };
});

import { POST } from "@/app/api/events/[id]/check-in/match/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchContact } from "@/lib/events/checkin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMatchContact = vi.mocked(matchContact);

function eventClient(event: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: event, error: null });
  return { from: () => chain } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/events/evt-1/check-in/match", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const published = { id: "evt-1", is_published: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateAdminClient.mockReturnValue(eventClient(published));
});

describe("POST /api/events/[id]/check-in/match", () => {
  it("requires an email or phone", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await post({ email: "nope" });
    expect(res.status).toBe(400);
  });

  it("404s an unpublished/unknown event", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(null));
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(404);
  });

  it("returns only { matched: true } — no names, kind, or strict (privacy)", async () => {
    mockedMatchContact.mockResolvedValue({ kind: "one", attendeeId: "att-1" });
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ matched: true });
    expect(json).not.toHaveProperty("strict");
    expect(json).not.toHaveProperty("attendeeId");
    expect(json).not.toHaveProperty("kind");
  });

  it("matches by phone", async () => {
    mockedMatchContact.mockResolvedValue({ kind: "one", attendeeId: "att-1" });
    const res = await post({ phone: "+41781234567" });
    const json = await res.json();
    expect(json).toEqual({ matched: true });
    expect(mockedMatchContact).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ phone: "+41781234567" })
    );
  });

  it("returns matched:false for an unknown contact", async () => {
    mockedMatchContact.mockResolvedValue({ kind: "none" });
    const res = await post({ email: "a@b.com" });
    const json = await res.json();
    expect(json).toEqual({ matched: false });
  });

  it("returns 503 when matching throws (fail-closed, not a misleading match)", async () => {
    mockedMatchContact.mockRejectedValue(new Error("db down"));
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(503);
  });
});
