import { describe, it, expect } from "vitest";
import { googleCalendarUrl } from "@/lib/events/calendar";

describe("googleCalendarUrl", () => {
  it("builds a timed 2-hour event when start_time is present", () => {
    const url = googleCalendarUrl({
      title: "Pilates & Polo",
      startDate: "2026-07-26",
      startTime: "18:00",
      endDate: null,
      location: "GPC Grounds",
      description: null,
    });
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260726T180000%2F20260726T200000");
    expect(url).toContain("text=Pilates+%26+Polo");
    expect(url).toContain("location=GPC+Grounds");
  });

  it("builds an all-day event spanning to the next day when there is no start_time", () => {
    const url = googleCalendarUrl({
      title: "Match Day",
      startDate: "2026-07-26",
      startTime: null,
      endDate: null,
      location: null,
      description: null,
    });
    expect(url).toContain("dates=20260726%2F20260727");
    expect(url).not.toContain("location=");
  });

  it("uses the event end date for a multi-day all-day event (exclusive end)", () => {
    const url = googleCalendarUrl({
      title: "Tournament",
      startDate: "2026-07-26",
      startTime: null,
      endDate: "2026-07-28",
      location: null,
      description: null,
    });
    expect(url).toContain("dates=20260726%2F20260729");
  });

  it("returns null for an unusable start date", () => {
    expect(
      googleCalendarUrl({
        title: "X",
        startDate: "not-a-date",
        startTime: null,
        endDate: null,
        location: null,
        description: null,
      })
    ).toBeNull();
  });

  it("includes the description as details when present", () => {
    const url = googleCalendarUrl({
      title: "X",
      startDate: "2026-07-26",
      startTime: "10:00",
      endDate: null,
      location: null,
      description: "Bring water",
    });
    expect(url).toContain("details=Bring+water");
  });
});
