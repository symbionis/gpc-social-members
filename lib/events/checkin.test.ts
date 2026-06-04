import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  normalizeEmail,
  resolveContactMatch,
  matchContact,
  recordAttendeeCheckin,
} from "@/lib/events/checkin";
import { WAIVER_VERSION } from "@/lib/events/waiver";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type QResult = { data: unknown; error: unknown };

// Thenable event_attendees query (matchContact awaits the eq/ilike chain directly).
function attendeeClient(rows: unknown[], opts: { error?: unknown } = {}) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "ilike", "is"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (r: QResult) => unknown) =>
        resolve({ data: rows, error: opts.error ?? null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

// recordAttendeeCheckin: a select→eq→eq→maybeSingle (the attendee load) followed by
// an update→eq→eq (the guarded flip). The update chain is awaited directly (thenable).
function recordClient(opts: {
  attendee: QResult;
  /** Rows returned by the guarded UPDATE...select(); [] simulates a lost race. */
  updated?: unknown[];
  updateError?: unknown;
  onUpdate?: (update: Record<string, unknown>) => void;
}) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => opts.attendee;
      c.update = (update: Record<string, unknown>) => {
        opts.onUpdate?.(update);
        const u: Record<string, unknown> = {};
        u.eq = () => u;
        u.is = () => u;
        u.select = () => u;
        (u as { then: unknown }).then = (resolve: (r: QResult) => unknown) =>
          resolve({
            data: opts.updated ?? [{ checked_in_at: "2026-06-06T18:00:00Z" }],
            error: opts.updateError ?? null,
          });
        return u;
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => vi.clearAllMocks());

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jean@X.CH ")).toBe("jean@x.ch");
  });
});

describe("resolveContactMatch", () => {
  it("returns none for no candidates", () => {
    expect(resolveContactMatch([])).toEqual({ kind: "none" });
  });

  it("returns the single matched attendee", () => {
    expect(
      resolveContactMatch([
        { id: "a1", email: "a@b.com", phone_e164: null, created_at: "2026-06-01T10:00:00Z" },
      ])
    ).toEqual({ kind: "one", attendeeId: "a1" });
  });

  it("resolves a shared contact to the earliest-created row (no name lookup)", () => {
    const rows = [
      { id: "late", email: null, phone_e164: "+41781234567", created_at: "2026-06-03T12:00:00Z" },
      { id: "early", email: null, phone_e164: "+41781234567", created_at: "2026-06-01T08:00:00Z" },
    ];
    expect(resolveContactMatch(rows)).toEqual({ kind: "one", attendeeId: "early" });
  });
});

describe("matchContact", () => {
  const row = {
    id: "att-1",
    email: "a@b.com",
    phone_e164: "+41781234567",
    created_at: "2026-06-01T10:00:00Z",
  };

  it("returns none when neither email nor phone is provided", async () => {
    mockedCreateAdminClient.mockReturnValue(attendeeClient([]));
    expect(await matchContact("evt", {})).toEqual({ kind: "none" });
  });

  it("matches by email (case-insensitively)", async () => {
    mockedCreateAdminClient.mockReturnValue(attendeeClient([row]));
    expect(await matchContact("evt", { email: "A@B.com" })).toEqual({
      kind: "one",
      attendeeId: "att-1",
    });
  });

  it("matches by phone", async () => {
    mockedCreateAdminClient.mockReturnValue(attendeeClient([row]));
    expect(await matchContact("evt", { phone: "+41781234567" })).toEqual({
      kind: "one",
      attendeeId: "att-1",
    });
  });

  it("unions both legs and dedupes by id", async () => {
    mockedCreateAdminClient.mockReturnValue(attendeeClient([row]));
    expect(
      await matchContact("evt", { email: "a@b.com", phone: "+41781234567" })
    ).toEqual({ kind: "one", attendeeId: "att-1" });
  });

  it("returns none when no roster row matches", async () => {
    mockedCreateAdminClient.mockReturnValue(attendeeClient([]));
    expect(await matchContact("evt", { email: "nobody@x.ch" })).toEqual({
      kind: "none",
    });
  });

  it("throws on a query error rather than returning none", async () => {
    mockedCreateAdminClient.mockReturnValue(
      attendeeClient([], { error: { message: "db down" } })
    );
    await expect(matchContact("evt", { email: "a@b.com" })).rejects.toBeTruthy();
  });
});

describe("recordAttendeeCheckin", () => {
  const base = {
    eventId: "evt",
    attendeeId: "att-1",
    language: "en" as const,
    marketingConsent: true,
    waiverAccepted: true,
  };

  it("returns not_found when the attendee row is missing", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({ attendee: { data: null, error: null } })
    );
    expect(await recordAttendeeCheckin(base)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("checks in a signed attendee and does not re-stamp the waiver", async () => {
    let captured: Record<string, unknown> | null = null;
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            waiver_accepted_at: "2026-06-01T09:00:00Z",
            language: "fr",
            marketing_consent: false,
            checked_in_at: null,
          },
          error: null,
        },
        onUpdate: (u) => (captured = u),
      })
    );
    const res = await recordAttendeeCheckin({ ...base, waiverAccepted: false });
    expect(res).toMatchObject({ ok: true, already: false });
    // Only checked_in_at is touched — the early signature is honored unchanged.
    expect(Object.keys(captured!)).toEqual(["checked_in_at"]);
    expect((res as { checkedInAt: string }).checkedInAt).toBeTruthy();
  });

  it("signs an unsigned attendee at the door, sourcing WAIVER_VERSION server-side", async () => {
    let captured: Record<string, unknown> | null = null;
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            name: "Jean Dupont",
            waiver_accepted_at: null,
            language: null,
            marketing_consent: null,
            checked_in_at: null,
          },
          error: null,
        },
        onUpdate: (u) => (captured = u),
      })
    );
    const res = await recordAttendeeCheckin(base);
    // The roster name is carried back for the confirmation greeting (no name is
    // collected at the door).
    expect(res).toMatchObject({ ok: true, already: false, name: "Jean Dupont" });
    expect(captured!.waiver_version).toBe(WAIVER_VERSION);
    expect(captured!.waiver_accepted_at).toBeTruthy();
    expect(captured!.language).toBe("en");
    expect(captured!.marketing_consent).toBe(true);
    expect(captured!.checked_in_at).toBeTruthy();
  });

  it("needs a waiver when unsigned and none was accepted", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            waiver_accepted_at: null,
            language: null,
            marketing_consent: null,
            checked_in_at: null,
          },
          error: null,
        },
      })
    );
    expect(
      await recordAttendeeCheckin({ ...base, waiverAccepted: false })
    ).toEqual({ ok: false, reason: "needs_waiver" });
  });

  it("is idempotent: an already-checked-in attendee returns the original time", async () => {
    let updated = false;
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            name: "Jean Dupont",
            waiver_accepted_at: "2026-06-01T09:00:00Z",
            language: "en",
            marketing_consent: true,
            checked_in_at: "2026-06-06T18:30:00Z",
          },
          error: null,
        },
        onUpdate: () => (updated = true),
      })
    );
    expect(await recordAttendeeCheckin(base)).toEqual({
      ok: true,
      already: true,
      checkedInAt: "2026-06-06T18:30:00Z",
      name: "Jean Dupont",
      registrationId: null,
      ticketTypeId: null,
    });
    expect(updated).toBe(false);
  });

  it("treats a lost concurrent race (zero rows updated) as already checked in", async () => {
    // Attendee reads as not-yet-arrived, but the guarded UPDATE matches zero rows
    // because a simultaneous submit won — must report already:true, not overwrite.
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            waiver_accepted_at: "2026-06-01T09:00:00Z",
            language: "fr",
            marketing_consent: false,
            checked_in_at: null,
          },
          error: null,
        },
        updated: [],
      })
    );
    expect(await recordAttendeeCheckin(base)).toMatchObject({
      ok: true,
      already: true,
    });
  });

  it("throws when the attendee load errors rather than coercing to not_found", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({ attendee: { data: null, error: { message: "db down" } } })
    );
    await expect(recordAttendeeCheckin(base)).rejects.toBeTruthy();
  });
});
