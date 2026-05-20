import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/checkin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/checkin")>();
  return { ...actual, matchEmail: vi.fn(), recordCheckin: vi.fn() };
});

import { POST } from "@/app/api/events/[id]/check-in/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchEmail, recordCheckin } from "@/lib/events/checkin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMatchEmail = vi.mocked(matchEmail);
const mockedRecordCheckin = vi.mocked(recordCheckin);

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

const publishedOpen = { id: "evt-1", is_published: true, strict_checkin: false };
const publishedStrict = { id: "evt-1", is_published: true, strict_checkin: true };

const validBody = {
  name: "Jean Dupont",
  email: "jean@example.com",
  language: "en",
  waiverAccepted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateAdminClient.mockReturnValue(eventClient(publishedOpen));
  mockedMatchEmail.mockResolvedValue({ kind: "registered", registrationId: "reg-1" });
  mockedRecordCheckin.mockResolvedValue({
    already: false,
    checkedInAt: "2026-05-22T10:00:00Z",
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

  it("requires a valid email", async () => {
    const res = await post({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("requires language to be fr or en", async () => {
    const res = await post({ ...validBody, language: "de" });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long inviter name", async () => {
    const res = await post({ ...validBody, inviterName: "a".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("requires the waiver to be accepted", async () => {
    const res = await post({ ...validBody, waiverAccepted: false });
    expect(res.status).toBe(400);
    expect(mockedRecordCheckin).not.toHaveBeenCalled();
  });

  it("404s an unpublished/unknown event", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(null));
    const res = await post(validBody);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/[id]/check-in — gating and recording", () => {
  it("records a matched registration and returns kind=registered (AE1)", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, kind: "registered", already: false });
    expect(mockedRecordCheckin).toHaveBeenCalledOnce();
  });

  it("blocks an unmatched guest under strict mode with 403 (AE5)", async () => {
    mockedCreateAdminClient.mockReturnValue(eventClient(publishedStrict));
    mockedMatchEmail.mockResolvedValue({ kind: "guest" });
    const res = await post(validBody);
    expect(res.status).toBe(403);
    expect(mockedRecordCheckin).not.toHaveBeenCalled();
  });

  it("requires an inviter for an unmatched guest when not strict (AE2)", async () => {
    mockedMatchEmail.mockResolvedValue({ kind: "guest" });
    const res = await post(validBody); // no inviterName
    expect(res.status).toBe(400);
    expect(mockedRecordCheckin).not.toHaveBeenCalled();
  });

  it("records an invited guest with an inviter when not strict (AE2)", async () => {
    mockedMatchEmail.mockResolvedValue({ kind: "guest" });
    const res = await post({ ...validBody, inviterName: "Marie Curie" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, kind: "guest" });
  });

  it("treats a repeat check-in as success with already=true (AE4)", async () => {
    mockedRecordCheckin.mockResolvedValue({
      already: true,
      checkedInAt: "2026-05-22T09:30:00Z",
    });
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, already: true });
  });
});
