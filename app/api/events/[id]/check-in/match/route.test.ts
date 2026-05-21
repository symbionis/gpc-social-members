import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/checkin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/checkin")>();
  return { ...actual, matchEmail: vi.fn() };
});

import { POST } from "@/app/api/events/[id]/check-in/match/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchEmail } from "@/lib/events/checkin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMatchEmail = vi.mocked(matchEmail);

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

const open = { id: "evt-1", is_published: true, strict_checkin: false };
const strict = { id: "evt-1", is_published: true, strict_checkin: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateAdminClient.mockReturnValue(eventClient(open));
});

describe("POST /api/events/[id]/check-in/match", () => {
  it("requires a valid email", async () => {
    const res = await post({ email: "nope" });
    expect(res.status).toBe(400);
  });

  it("404s an unpublished/unknown event", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(null));
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(404);
  });

  it("returns matched:true for a registration without disclosing the kind (AE3)", async () => {
    mockedMatchEmail.mockResolvedValue({ kind: "registered", registrationId: "r1" });
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ matched: true, strict: false });
    expect(json).not.toHaveProperty("kind");
    expect(json).not.toHaveProperty("registrationId");
  });

  it("returns matched:true for a member without disclosing membership (AE3)", async () => {
    mockedMatchEmail.mockResolvedValue({ kind: "member", memberId: "m1" });
    const res = await post({ email: "a@b.com" });
    const json = await res.json();
    expect(json).toEqual({ matched: true, strict: false });
    expect(json).not.toHaveProperty("memberId");
  });

  it("returns matched:false for an unknown email", async () => {
    mockedMatchEmail.mockResolvedValue({ kind: "guest" });
    const res = await post({ email: "a@b.com" });
    const json = await res.json();
    expect(json).toEqual({ matched: false, strict: false });
  });

  it("passes through the strict flag", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(strict));
    mockedMatchEmail.mockResolvedValue({ kind: "guest" });
    const res = await post({ email: "a@b.com" });
    const json = await res.json();
    expect(json).toEqual({ matched: false, strict: true });
  });

  it("returns 503 when matching throws (fail-closed, not a misleading match)", async () => {
    mockedMatchEmail.mockRejectedValue(new Error("db down"));
    const res = await post({ email: "a@b.com" });
    expect(res.status).toBe(503);
  });
});
