import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { getEventReminderSummary } from "@/lib/events/reminder-summary";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type Row = Record<string, unknown>;

function client(rows: Row[]) {
  return {
    from: () => {
      let rFrom = 0;
      let rTo = Number.MAX_SAFE_INTEGER;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.order = () => c;
      c.range = (f: number, t: number) => {
        rFrom = f;
        rTo = t;
        return c;
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: rows.slice(rFrom, rTo + 1), error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getEventReminderSummary", () => {
  it("groups by (days_before, slot) with counts and the latest sent_at", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client([
        { days_before: 7, slot: "morning", sent_at: "2026-05-01T06:00:00Z" },
        { days_before: 7, slot: "morning", sent_at: "2026-05-01T06:05:00Z" },
        { days_before: 1, slot: "evening", sent_at: "2026-05-07T16:00:00Z" },
      ])
    );
    const summary = await getEventReminderSummary("e1");
    expect(summary).toEqual([
      { days_before: 7, slot: "morning", recipient_count: 2, last_sent_at: "2026-05-01T06:05:00Z" },
      { days_before: 1, slot: "evening", recipient_count: 1, last_sent_at: "2026-05-07T16:00:00Z" },
    ]);
  });

  it("returns an empty list for an event with no reminder sends", async () => {
    mockedCreateAdminClient.mockReturnValue(client([]));
    expect(await getEventReminderSummary("e1")).toEqual([]);
  });

  it("counts all rows past the 1000-row page boundary", async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      days_before: 1,
      slot: "evening",
      sent_at: `2026-05-07T16:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    mockedCreateAdminClient.mockReturnValue(client(many));
    const summary = await getEventReminderSummary("e1");
    expect(summary).toHaveLength(1);
    expect(summary[0].recipient_count).toBe(1500);
  });

  it("orders by days_before descending then slot", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client([
        { days_before: 1, slot: "morning", sent_at: "2026-05-07T06:00:00Z" },
        { days_before: 7, slot: "evening", sent_at: "2026-05-01T16:00:00Z" },
        { days_before: 1, slot: "evening", sent_at: "2026-05-07T16:00:00Z" },
      ])
    );
    const summary = await getEventReminderSummary("e1");
    expect(summary.map((r) => `${r.days_before}|${r.slot}`)).toEqual([
      "7|evening",
      "1|evening",
      "1|morning",
    ]);
  });
});
