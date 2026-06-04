import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/events/roster", () => ({ addSelfRegistrationChildren: vi.fn() }));

import { POST } from "@/app/api/public/registrations/[token]/children/route";
import { addSelfRegistrationChildren } from "@/lib/events/roster";

const mockedAdd = vi.mocked(addSelfRegistrationChildren);

function post(body: unknown, token = "tok-1") {
  const req = new Request(
    `http://localhost/api/public/registrations/${token}/children`,
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdd.mockResolvedValue({ status: "ok", added: 2, remaining: 0 });
});

describe("POST /api/public/registrations/[token]/children", () => {
  it("rejects a non-array names", async () => {
    const res = await post({ names: "Sofia" });
    expect(res.status).toBe(400);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("rejects an all-blank names list", async () => {
    const res = await post({ names: ["  ", ""] });
    expect(res.status).toBe(400);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it("trims + forwards the names and returns the added count", async () => {
    const res = await post({ names: [" Sofia ", "Leo", ""] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, added: 2, remaining: 0 });
    expect(mockedAdd).toHaveBeenCalledWith("tok-1", ["Sofia", "Leo"]);
  });

  it("maps a full child allotment to 409", async () => {
    mockedAdd.mockResolvedValue({ status: "full", added: 0 });
    const res = await post({ names: ["Sofia"] });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("full");
  });

  it("maps an unknown token to 404", async () => {
    mockedAdd.mockResolvedValue({ status: "invalid" });
    const res = await post({ names: ["Sofia"] });
    expect(res.status).toBe(404);
  });
});
