import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/broadcast/send", () => ({ sendEventMessage: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/messages/send/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventMessage } from "@/lib/broadcast/send";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEventMessage);

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(
  admins: { id: string; role: string }[],
  event: { id: string } | null
) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => ({
        data: table === "events" ? event : null,
        error: null,
      });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: table === "admin_users" ? admins : null, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "e1") {
  const req = new Request("http://localhost/api/admin/events/e1/messages/send", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const eventsAdmin = [{ id: "a1", role: "events_admin" }];
const superAdmin = [{ id: "a2", role: "super_admin" }];
const validBody = {
  kind: "event_pre",
  subject: "Heads up",
  body_html: "<p>Venue moved to the south field.</p>",
};
const sentResult = {
  broadcast_id: "b1",
  recipient_count: 3,
  sent: 3,
  failed: 0,
  skipped: 0,
  errors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "ea@x.com" }));
  mockedCreateAdminClient.mockReturnValue(adminClient(eventsAdmin, { id: "e1" }));
  mockedSend.mockResolvedValue({ status: "sent", result: sentResult });
});

describe("POST /api/admin/events/[id]/messages/send — auth", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post(validBody)).status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient([], { id: "e1" }));
    expect((await post(validBody)).status).toBe(403);
  });

  it("allows an events_admin to send", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(mockedSend).toHaveBeenCalledOnce();
  });

  it("allows a super_admin to send", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient(superAdmin, { id: "e1" }));
    expect((await post(validBody)).status).toBe(200);
  });

  it("404s when the event does not exist", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient(eventsAdmin, null));
    expect((await post(validBody)).status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/events/[id]/messages/send — validation", () => {
  it("400s invalid JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("400s an empty body", async () => {
    expect((await post({ kind: "event_pre", subject: "Hi", body_html: "<p></p>" })).status).toBe(400);
  });

  it("400s an empty subject", async () => {
    expect((await post({ kind: "event_pre", subject: "  ", body_html: "<p>x</p>" })).status).toBe(400);
  });

  it("400s an invalid kind", async () => {
    expect((await post({ kind: "newsletter", subject: "Hi", body_html: "<p>x</p>" })).status).toBe(400);
  });
});

describe("POST /api/admin/events/[id]/messages/send — outcomes", () => {
  it("returns the send result on success", async () => {
    const res = await post(validBody);
    const json = await res.json();
    expect(json).toMatchObject({ broadcast_id: "b1", sent: 3, deduplicated: false });
  });

  it("409s when a send for this event is already in progress", async () => {
    mockedSend.mockResolvedValue({ status: "in_progress" });
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe("in_progress");
  });

  it("returns the prior result with deduplicated:true on idempotency match", async () => {
    mockedSend.mockResolvedValue({
      status: "duplicate",
      result: { ...sentResult, broadcast_id: "b9" },
    });
    const res = await post({ ...validBody, idempotency_key: "k1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ broadcast_id: "b9", deduplicated: true });
  });

  it("passes the resolved admin id as created_by", async () => {
    await post(validBody);
    expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({ created_by: "a1", event_id: "e1" }));
  });

  it("500s with a structured body when the send throws (adapter-wide failure)", async () => {
    mockedSend.mockRejectedValue(new Error("event-message template not found"));
    const res = await post(validBody);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("template not found");
  });
});
