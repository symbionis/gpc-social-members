import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/events/door-access", () => ({ resolveDoorEvent: vi.fn() }));
vi.mock("@/lib/events/checkin", () => ({
  checkInByCredential: vi.fn(),
  recordAttendeeCheckin: vi.fn(),
}));

import { POST } from "@/app/api/public/door/[id]/check-in/route";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { checkInByCredential, recordAttendeeCheckin } from "@/lib/events/checkin";

const mockedResolve = vi.mocked(resolveDoorEvent);
const mockedCheckin = vi.mocked(checkInByCredential);
const mockedRecord = vi.mocked(recordAttendeeCheckin);
const TICKET = "11111111-2222-3333-4444-555555555555";

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

  it("checks in a found ticket by id (lost-QR path)", async () => {
    mockedRecord.mockResolvedValue({
      ok: true,
      already: false,
      checkedInAt: "2026-07-01T18:00:00Z",
      name: "Bo",
      registrationId: "reg",
      ticketTypeId: "tt",
    });
    const res = await post({ ticketId: TICKET });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "checked_in", name: "Bo" });
    expect(mockedCheckin).not.toHaveBeenCalled();
  });

  it("surfaces needs_waiver for a by-id check-in of an unsigned guest", async () => {
    mockedRecord.mockResolvedValue({ ok: false, reason: "needs_waiver" });
    const res = await post({ ticketId: TICKET });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "needs_waiver" });
  });
});
