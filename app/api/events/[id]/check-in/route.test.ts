import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/checkin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/checkin")>();
  return {
    ...actual,
    matchContact: vi.fn(),
    recordAttendeeCheckin: vi.fn(),
  };
});

import { POST } from "@/app/api/events/[id]/check-in/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchContact, recordAttendeeCheckin } from "@/lib/events/checkin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMatchContact = vi.mocked(matchContact);
const mockedRecordAttendeeCheckin = vi.mocked(recordAttendeeCheckin);

// Minimal fake client whose only used path is the events lookup chain.
function eventClient(event: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: event, error: null });
  return { from: () => chain } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/events/evt-1/check-in", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const published = { id: "evt-1", is_published: true };

const validBody = {
  name: "Jean Dupont",
  email: "jean@example.com",
  language: "en",
  waiverAccepted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateAdminClient.mockReturnValue(eventClient(published));
  mockedMatchContact.mockResolvedValue({ kind: "one", attendeeId: "att-1" });
  mockedRecordAttendeeCheckin.mockResolvedValue({
    ok: true,
    already: false,
    checkedInAt: "2026-06-06T18:00:00Z",
  });
});

describe("POST /api/events/[id]/check-in — validation", () => {
  it("rejects invalid JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("requires a name", async () => {
    const res = await post({ ...validBody, name: "  " });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long name", async () => {
    const res = await post({ ...validBody, name: "a".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await post({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("requires at least an email or a phone", async () => {
    const res = await post({ ...validBody, email: "", phone: "" });
    expect(res.status).toBe(400);
    expect(mockedMatchContact).not.toHaveBeenCalled();
  });

  it("accepts a phone-only arrival (no email)", async () => {
    const res = await post({
      name: "Jean",
      phone: "+41781234567",
      language: "en",
      waiverAccepted: true,
    });
    expect(res.status).toBe(200);
    expect(mockedMatchContact).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ phone: "+41781234567" })
    );
  });

  it("requires language to be fr or en", async () => {
    const res = await post({ ...validBody, language: "de" });
    expect(res.status).toBe(400);
  });

  it("404s an unpublished/unknown event", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(null));
    const res = await post(validBody);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/[id]/check-in — strict gate and recording", () => {
  it("records a matched attendee and returns ok with the arrival time (AE1)", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      name: "Jean Dupont",
      already: false,
      checkedInAt: "2026-06-06T18:00:00Z",
    });
    expect(json).not.toHaveProperty("kind");
    expect(mockedRecordAttendeeCheckin).toHaveBeenCalledOnce();
  });

  it("returns not_found for an unmatched arrival with no routing data (AE3)", async () => {
    mockedMatchContact.mockResolvedValue({ kind: "none" });
    const res = await post(validBody);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: "not_found" });
    expect(mockedRecordAttendeeCheckin).not.toHaveBeenCalled();
  });

  it("returns needs_waiver when a matched attendee is unsigned and didn't accept (AE2)", async () => {
    mockedRecordAttendeeCheckin.mockResolvedValue({
      ok: false,
      reason: "needs_waiver",
    });
    const res = await post({ ...validBody, waiverAccepted: false });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: "needs_waiver" });
  });

  it("returns the original arrival time on a repeat check-in (idempotent, R24)", async () => {
    mockedRecordAttendeeCheckin.mockResolvedValue({
      ok: true,
      already: true,
      checkedInAt: "2026-06-06T17:30:00Z",
    });
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      already: true,
      checkedInAt: "2026-06-06T17:30:00Z",
    });
  });

  it("returns not_found when the row vanishes between match and record", async () => {
    mockedRecordAttendeeCheckin.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    const res = await post(validBody);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("POST /api/events/[id]/check-in — communication consent", () => {
  it("defaults consent to true when the field is absent (ticked by default)", async () => {
    await post(validBody);
    expect(mockedRecordAttendeeCheckin).toHaveBeenCalledWith(
      expect.objectContaining({ marketingConsent: true })
    );
  });

  it("records consent=false when the box is unchecked", async () => {
    await post({ ...validBody, marketingConsent: false });
    expect(mockedRecordAttendeeCheckin).toHaveBeenCalledWith(
      expect.objectContaining({ marketingConsent: false })
    );
  });

  it("forwards the accepted waiver flag to the recorder", async () => {
    await post(validBody);
    expect(mockedRecordAttendeeCheckin).toHaveBeenCalledWith(
      expect.objectContaining({ waiverAccepted: true })
    );
  });
});
