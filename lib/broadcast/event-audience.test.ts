import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolveEventAudience } from "@/lib/broadcast/event-audience";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type Row = Record<string, unknown>;

/**
 * Query-builder mock that applies .eq / .in filters then the .range slice, so
 * pagination and SQL-level filtering (status) behave like the real client.
 */
function client(rowsByTable: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      let rFrom = 0;
      let rTo = Number.MAX_SAFE_INTEGER;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, val: unknown) => {
        eqs.push([col, val]);
        return c;
      };
      c.in = (col: string, vals: unknown[]) => {
        ins.push([col, vals]);
        return c;
      };
      // Supports the single `.not(col, "is", null)` shape fetchCheckins uses to
      // keep only checked-in attendees (checked_in_at IS NOT NULL).
      const nots: Array<[string, "is", null]> = [];
      c.not = (col: string, op: "is", val: null) => {
        nots.push([col, op, val]);
        return c;
      };
      c.order = () => c;
      c.range = (f: number, t: number) => {
        rFrom = f;
        rTo = t;
        return c;
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        let rows = rowsByTable[table] ?? [];
        for (const [col, val] of eqs) rows = rows.filter((r) => r[col] === val);
        for (const [col, vals] of ins) rows = rows.filter((r) => vals.includes(r[col]));
        // `.not(col, "is", null)` → keep rows whose column is non-null.
        for (const [col] of nots) rows = rows.filter((r) => r[col] != null);
        return resolve({ data: rows.slice(rFrom, rTo + 1), error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveEventAudience — pre-event (registered attendees)", () => {
  it("includes paid and free registrations and excludes cancelled/refunded", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_registrations: [
          { email: "a@x.com", name: "Ann Lee", member_id: "m1", status: "paid", event_id: "e1" },
          { email: "b@x.com", name: "Bo Ng", member_id: null, status: "free", event_id: "e1" },
          { email: "c@x.com", name: "Cy Doe", member_id: "m3", status: "cancelled", event_id: "e1" },
          { email: "d@x.com", name: "Di Fox", member_id: "m4", status: "refunded", event_id: "e1" },
        ],
      })
    );
    const { recipients, skipped } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_pre",
    });
    expect(recipients.map((r) => r.email).sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(skipped).toBe(0);
  });

  // AE1: a registrant is messaged regardless of any marketing flag — pre-event
  // applies no consent filter at all.
  it("does not filter pre-event on consent", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_registrations: [
          { email: "a@x.com", name: "Ann", member_id: "m1", status: "paid", event_id: "e1" },
        ],
      })
    );
    const { recipients } = await resolveEventAudience({ event_id: "e1", kind: "event_pre" });
    expect(recipients).toHaveLength(1);
  });

  it("splits a single name into first/last and carries nullable member_id", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        event_registrations: [
          { email: "g@x.com", name: "Guest", member_id: null, status: "free", event_id: "e1" },
          { email: "h@x.com", name: "Mary Jane Smith", member_id: "m9", status: "paid", event_id: "e1" },
        ],
      })
    );
    const { recipients } = await resolveEventAudience({ event_id: "e1", kind: "event_pre" });
    const guest = recipients.find((r) => r.email === "g@x.com")!;
    const mary = recipients.find((r) => r.email === "h@x.com")!;
    expect(guest).toMatchObject({ member_id: null, first_name: "Guest", last_name: "", tier_name: null });
    expect(mary).toMatchObject({ first_name: "Mary", last_name: "Jane Smith" });
  });
});

describe("resolveEventAudience — post-event (checked-in attendees)", () => {
  // Post-event recipients now come from event_attendees WHERE checked_in_at is
  // set (event_checkins is frozen). A not-yet-arrived attendee (null
  // checked_in_at) must be excluded.
  const checkins = {
    tickets: [
      { email: "yes@x.com", name: "Yes", member_id: "m1", marketing_consent: true, checked_in_at: "2026-06-06T10:00:00Z", event_id: "e1" },
      { email: "no@x.com", name: "No", member_id: null, marketing_consent: false, checked_in_at: "2026-06-06T10:01:00Z", event_id: "e1" },
      { email: "nullc@x.com", name: "Nullc", member_id: null, marketing_consent: null, checked_in_at: "2026-06-06T10:02:00Z", event_id: "e1" },
      { email: "noshow@x.com", name: "Noshow", member_id: null, marketing_consent: true, checked_in_at: null, event_id: "e1" },
    ],
  };

  // AE2: override off → only opted-in check-ins; the declined one is skipped.
  it("respects consent by default and counts the rest as skipped", async () => {
    mockedCreateAdminClient.mockReturnValue(client(checkins));
    const { recipients, skipped } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
    });
    expect(recipients.map((r) => r.email)).toEqual(["yes@x.com"]);
    expect(skipped).toBe(2); // false + null both excluded
  });

  // AE2: null marketing_consent is treated as not-consented.
  it("treats null marketing_consent as not consented", async () => {
    mockedCreateAdminClient.mockReturnValue(client(checkins));
    const { recipients } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
      include_non_consented: false,
    });
    expect(recipients.map((r) => r.email)).not.toContain("nullc@x.com");
  });

  // Only arrived attendees (checked_in_at set) are post-event recipients; a
  // rostered no-show is never messaged even with the consent override on.
  it("excludes attendees who never checked in (checked_in_at null)", async () => {
    mockedCreateAdminClient.mockReturnValue(client(checkins));
    const { recipients } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
      include_non_consented: true,
    });
    expect(recipients.map((r) => r.email)).not.toContain("noshow@x.com");
  });

  // AE3: override on → everyone who checked in, override recorded by caller.
  it("includes non-consented check-ins when the override is on", async () => {
    mockedCreateAdminClient.mockReturnValue(client(checkins));
    const { recipients, skipped } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
      include_non_consented: true,
    });
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "no@x.com",
      "nullc@x.com",
      "yes@x.com",
    ]);
    expect(skipped).toBe(0);
  });
});

describe("resolveEventAudience — dedup, pagination, empty", () => {
  it("de-duplicates by lowercased email", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        tickets: [
          { email: "Dup@X.com", name: "Dup One", member_id: "m1", marketing_consent: true, checked_in_at: "2026-06-06T10:00:00Z", event_id: "e1" },
          { email: "dup@x.com", name: "Dup Two", member_id: null, marketing_consent: true, checked_in_at: "2026-06-06T10:01:00Z", event_id: "e1" },
        ],
      })
    );
    const { recipients } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
      include_non_consented: true,
    });
    expect(recipients).toHaveLength(1);
  });

  it("does not double-count a skipped email that also appears as included", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        tickets: [
          { email: "mix@x.com", name: "Mix", member_id: null, marketing_consent: false, checked_in_at: "2026-06-06T10:00:00Z", event_id: "e1" },
          { email: "mix@x.com", name: "Mix", member_id: "m1", marketing_consent: true, checked_in_at: "2026-06-06T10:01:00Z", event_id: "e1" },
        ],
      })
    );
    const { recipients, skipped } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_post",
    });
    expect(recipients.map((r) => r.email)).toEqual(["mix@x.com"]);
    expect(skipped).toBe(0);
  });

  it("returns all recipients past the 1000-row page boundary (registrations)", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      email: `u${i}@x.com`,
      name: `U ${i}`,
      member_id: null,
      status: "paid",
      event_id: "e1",
    }));
    mockedCreateAdminClient.mockReturnValue(client({ event_registrations: many }));
    const { recipients } = await resolveEventAudience({ event_id: "e1", kind: "event_pre" });
    expect(recipients).toHaveLength(1500);
  });

  it("returns all recipients past the 1000-row page boundary (check-ins)", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      email: `c${i}@x.com`,
      name: `C ${i}`,
      member_id: null,
      marketing_consent: true,
      checked_in_at: "2026-06-06T10:00:00Z",
      event_id: "e1",
    }));
    mockedCreateAdminClient.mockReturnValue(client({ tickets: many }));
    const { recipients } = await resolveEventAudience({ event_id: "e1", kind: "event_post" });
    expect(recipients).toHaveLength(1500);
  });

  it("returns empty for an event with no matching rows", async () => {
    mockedCreateAdminClient.mockReturnValue(client({ event_registrations: [] }));
    const { recipients, skipped } = await resolveEventAudience({
      event_id: "e1",
      kind: "event_pre",
    });
    expect(recipients).toEqual([]);
    expect(skipped).toBe(0);
  });
});
