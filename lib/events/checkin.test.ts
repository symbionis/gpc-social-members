import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { recordAttendeeCheckin } from "@/lib/events/checkin";
import { WAIVER_VERSION } from "@/lib/events/waiver";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type QResult = { data: unknown; error: unknown };

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

  it("refuses a cancelled ticket (U14) — a void ticket must not be admitted at the door", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        attendee: {
          data: {
            id: "att-1",
            name: "Cancelled Guest",
            registration_id: "r1",
            ticket_type_id: "tt1",
            waiver_accepted_at: "2026-01-01T00:00:00Z",
            language: "en",
            marketing_consent: true,
            checked_in_at: null,
            cancellation_status: "requested",
          },
          error: null,
        },
      })
    );
    expect(await recordAttendeeCheckin(base)).toEqual({ ok: false, reason: "not_found" });
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
