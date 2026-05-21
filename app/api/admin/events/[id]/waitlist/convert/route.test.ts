import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/events/registration", () => ({
  generateReferenceCode: vi.fn(() => "EV-TEST1234"),
  findActiveMemberByEmail: vi.fn(),
  hasExistingRegistration: vi.fn(),
}));
vi.mock("@/lib/email/event-waitlist", () => ({ sendWaitlistConfirmation: vi.fn() }));
vi.mock("@/lib/events/seat-usage", () => ({ getSeatsUsed: vi.fn() }));

import { POST } from "@/app/api/admin/events/[id]/waitlist/convert/route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findActiveMemberByEmail, hasExistingRegistration } from "@/lib/events/registration";
import { sendWaitlistConfirmation } from "@/lib/email/event-waitlist";
import { getSeatsUsed } from "@/lib/events/seat-usage";

const mockedCreateClient = vi.mocked(createClient);
const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedHasExisting = vi.mocked(hasExistingRegistration);
const mockedFindMember = vi.mocked(findActiveMemberByEmail);
const mockedSendEmail = vi.mocked(sendWaitlistConfirmation);
const mockedSeatsUsed = vi.mocked(getSeatsUsed);

let capturedInsert: Record<string, unknown> | null = null;

function sessionClient(user: { email: string } | null) {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}

function adminClient(opts: {
  admins?: { id: string; role: string }[];
  waitlistEntry?: unknown;
  waitlistErr?: unknown;
  insertResult?: { data: unknown; error: unknown };
  deleteErr?: unknown;
}) {
  return {
    from: (table: string) => {
      let isInsert = false;
      let isDelete = false;
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit", "ilike", "order"]) c[m] = () => c;
      c.insert = (row: Record<string, unknown>) => {
        isInsert = true;
        capturedInsert = row;
        return c;
      };
      c.delete = () => {
        isDelete = true;
        return c;
      };
      c.single = async () =>
        isInsert
          ? opts.insertResult ?? { data: { id: "reg-new" }, error: null }
          : { data: null, error: null };
      c.maybeSingle = async () =>
        table === "event_waitlist"
          ? { data: opts.waitlistEntry ?? null, error: opts.waitlistErr ?? null }
          : { data: null, error: null };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "admin_users") return resolve({ data: opts.admins ?? [], error: null });
        if (isDelete) return resolve({ data: null, error: opts.deleteErr ?? null });
        return resolve({ data: null, error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, eventId = "evt-1") {
  const req = new Request("http://localhost/api/admin/events/evt-1/waitlist/convert", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ id: eventId }) });
}

const superAdmin = [{ id: "admin-1", role: "super_admin" }];
const entry = { id: "wl-1", name: "Astrid Ferrari", email: "Astrid@x.ch" };

beforeEach(() => {
  vi.clearAllMocks();
  capturedInsert = null;
  mockedCreateClient.mockResolvedValue(sessionClient({ email: "admin@x.co" }));
  mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin, waitlistEntry: entry }));
  mockedHasExisting.mockResolvedValue(false);
  mockedFindMember.mockResolvedValue(null);
  mockedSendEmail.mockResolvedValue({ success: true });
  mockedSeatsUsed.mockResolvedValue(501);
});

describe("POST /api/admin/events/[id]/waitlist/convert — auth & validation", () => {
  it("401s an unauthenticated caller", async () => {
    mockedCreateClient.mockResolvedValue(sessionClient(null));
    expect((await post({ waitlistId: "wl-1", quantity: 1 })).status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: [], waitlistEntry: entry }));
    expect((await post({ waitlistId: "wl-1", quantity: 1 })).status).toBe(403);
  });

  it("400s a missing waitlistId", async () => {
    expect((await post({ quantity: 1 })).status).toBe(400);
  });

  it.each([1.5, 0, 7, "3"])("400s a non-strict-integer quantity %p", async (q) => {
    expect((await post({ waitlistId: "wl-1", quantity: q })).status).toBe(400);
  });

  it("404s when the entry is absent / belongs to another event (scoped lookup)", async () => {
    mockedCreateAdminClient.mockReturnValue(adminClient({ admins: superAdmin, waitlistEntry: null }));
    expect((await post({ waitlistId: "wl-x", quantity: 1 })).status).toBe(404);
  });
});

describe("POST /api/admin/events/[id]/waitlist/convert — conversion", () => {
  it("503s when a lookup throws (DB error, not an opaque 500)", async () => {
    mockedHasExisting.mockRejectedValue(new Error("db down"));
    const res = await post({ waitlistId: "wl-1", quantity: 1 });
    expect(res.status).toBe(503);
    expect(capturedInsert).toBeNull();
  });

  it("409s when the email already has a registration (no insert)", async () => {
    mockedHasExisting.mockResolvedValue(true);
    const res = await post({ waitlistId: "wl-1", quantity: 1 });
    expect(res.status).toBe(409);
    expect(capturedInsert).toBeNull();
  });

  it("creates a free, comped registration recording converted_by, and emails (AE1)", async () => {
    const res = await post({ waitlistId: "wl-1", quantity: 1 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, reference_code: "EV-TEST1234", email_sent: true, seats_used: 501 });
    expect(capturedInsert).toMatchObject({
      name: "Astrid Ferrari",
      email: "astrid@x.ch",
      status: "free",
      unit_amount_chf: 0,
      total_amount_chf: 0,
      converted_by: "admin-1",
      is_member: false,
    });
    expect(mockedSendEmail).toHaveBeenCalledWith("reg-new");
  });

  it("sets is_member + member_id when the email matches an active member (AE2)", async () => {
    mockedFindMember.mockResolvedValue({ id: "mem-9" });
    await post({ waitlistId: "wl-1", quantity: 1 });
    expect(capturedInsert).toMatchObject({ is_member: true, member_id: "mem-9" });
  });

  it("uses the requested ticket quantity (AE4)", async () => {
    await post({ waitlistId: "wl-1", quantity: 3 });
    expect(capturedInsert).toMatchObject({ quantity: 3 });
  });

  it("returns 409 on a 23505 unique-violation race", async () => {
    mockedCreateAdminClient.mockReturnValue(
      adminClient({ admins: superAdmin, waitlistEntry: entry, insertResult: { data: null, error: { code: "23505" } } })
    );
    expect((await post({ waitlistId: "wl-1", quantity: 1 })).status).toBe(409);
  });

  it("still succeeds (200) when the confirmation email fails", async () => {
    mockedSendEmail.mockResolvedValue({ success: false, error: "no template" });
    const res = await post({ waitlistId: "wl-1", quantity: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).email_sent).toBe(false);
  });
});
