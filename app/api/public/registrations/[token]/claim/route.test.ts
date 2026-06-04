import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/events/roster", () => ({ claimSelfRegistration: vi.fn() }));

import { POST } from "@/app/api/public/registrations/[token]/claim/route";
import { claimSelfRegistration } from "@/lib/events/roster";
import { WAIVER_VERSION } from "@/lib/events/waiver";

const mockedClaim = vi.mocked(claimSelfRegistration);

function post(body: unknown, token = "tok-1") {
  const req = new Request(
    `http://localhost/api/public/registrations/${token}/claim`,
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return POST(req as never, { params: Promise.resolve({ token }) });
}

const validBody = { name: "Bo Guest", email: "bo@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedClaim.mockResolvedValue({
    status: "claimed",
    attendeeId: "att-1",
    name: "Bo Guest",
    already: false,
  });
});

describe("POST /api/public/registrations/[token]/claim — validation", () => {
  it("rejects invalid JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("requires a name", async () => {
    const res = await post({ ...validBody, name: "  " });
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("requires at least an email or a phone", async () => {
    const res = await post({ name: "Bo", email: "", phone: "" });
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const res = await post({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("accepts a phone-only guest (no email)", async () => {
    const res = await post({ name: "Bo", phone: "+41781234567" });
    expect(res.status).toBe(200);
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ phone_e164: "+41781234567", email: null })
    );
  });

  it("requires a language only when signing the waiver", async () => {
    const res = await post({ ...validBody, waiverAccepted: true, language: "de" });
    expect(res.status).toBe(400);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("passes a valid ticketTypeId through to the claim", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    await post({ ...validBody, ticketTypeId: id });
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ ticketTypeId: id })
    );
  });

  it("drops a malformed ticketTypeId (sends null, never rejects)", async () => {
    const res = await post({ ...validBody, ticketTypeId: "not-a-uuid" });
    expect(res.status).toBe(200);
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ ticketTypeId: null })
    );
  });
});

describe("POST /api/public/registrations/[token]/claim — claim outcomes", () => {
  it("records a claimed guest and echoes the roster name", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, name: "Bo Guest", already: false });
  });

  it("passes the server waiver version only when the guest signs now", async () => {
    await post({ ...validBody, waiverAccepted: true, language: "en" });
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ waiverVersion: WAIVER_VERSION, waiverAccepted: true })
    );

    mockedClaim.mockClear();
    await post(validBody); // no waiver
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.objectContaining({ waiverVersion: null, waiverAccepted: false })
    );
  });

  it("reports a full ticket type (type_full → 409)", async () => {
    mockedClaim.mockResolvedValue({ status: "type_full" });
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "type_full" });
  });

  it("reports a double-submit idempotently (already=true)", async () => {
    mockedClaim.mockResolvedValue({
      status: "claimed",
      attendeeId: "att-1",
      name: "Bo Guest",
      already: true,
    });
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect((await res.json()).already).toBe(true);
  });

  it("returns 409 full when the party is full", async () => {
    mockedClaim.mockResolvedValue({ status: "full" });
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "full" });
  });

  it("returns 409 inactive for an unconfirmed registration", async () => {
    mockedClaim.mockResolvedValue({ status: "inactive" });
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "inactive" });
  });

  it("returns 404 invalid for an unknown token", async () => {
    mockedClaim.mockResolvedValue({ status: "invalid" });
    const res = await post(validBody);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid" });
  });

  it("maps an RPC invalid_input to a 400", async () => {
    mockedClaim.mockResolvedValue({ status: "invalid_input", reason: "contact" });
    const res = await post(validBody);
    expect(res.status).toBe(400);
  });

  it("returns 500 when the claim throws", async () => {
    mockedClaim.mockRejectedValue(new Error("db down"));
    const res = await post(validBody);
    expect(res.status).toBe(500);
  });
});
