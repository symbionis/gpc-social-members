import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));
vi.mock("@/lib/events/checkin", () => ({ checkInByCredential: vi.fn() }));

import { POST } from "@/app/api/public/door/[id]/check-in/route";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { checkInByCredential } from "@/lib/events/checkin";

const mockedResolve = vi.mocked(resolveDoorEvent);
const mockedCheckin = vi.mocked(checkInByCredential);

function post(body: unknown, id = "evt-1") {
  const req = new Request(`http://localhost/api/public/door/${id}/check-in`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ id: "evt-1", title: "X", startDate: null });
  mockedCheckin.mockResolvedValue({ status: "checked_in", name: "Ann", ticket_type_title: "Adult" });
});

describe("POST /api/public/door/[id]/check-in", () => {
  it("404s an unknown/unpublished event", async () => {
    mockedResolve.mockResolvedValue(null);
    const res = await post({ token: "abc123def456ghi789" });
    expect(res.status).toBe(404);
    expect(mockedCheckin).not.toHaveBeenCalled();
  });

  it("returns not_recognised for a non-token value without calling the RPC", async () => {
    const res = await post({ token: "hi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_recognised" });
    expect(mockedCheckin).not.toHaveBeenCalled();
  });

  it("parses a /c/<token> URL and checks in", async () => {
    const res = await post({ token: "https://app.test/c/abc123def456ghi789xyz" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "checked_in", name: "Ann" });
    expect(mockedCheckin.mock.calls[0][0]).toMatchObject({ credentialToken: "abc123def456ghi789xyz" });
  });

  it("sources the waiver version server-side when accepting", async () => {
    mockedCheckin.mockResolvedValue({ status: "checked_in" });
    await post({ token: "abc123def456ghi789xyz", name: "Ann", waiverAccepted: true, language: "en" });
    const arg = mockedCheckin.mock.calls[0][0];
    expect(arg.waiverAccepted).toBe(true);
    expect(arg.waiverVersion).toBeTruthy();
  });

  it("rejects an invalid waiver language", async () => {
    const res = await post({ token: "abc123def456ghi789xyz", waiverAccepted: true, language: "de" });
    expect(res.status).toBe(400);
  });
});
