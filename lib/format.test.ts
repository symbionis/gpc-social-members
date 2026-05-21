import { describe, it, expect } from "vitest";
import { formatWaiverDate } from "@/lib/format";

describe("formatWaiverDate", () => {
  // 2026-05-21 is a Thursday in Europe/Zurich — the date the original waiver
  // got wrong ("Thursday, May 22" — but May 22 is a Friday).
  it("formats the Open Doors date in English", () => {
    expect(formatWaiverDate("2026-05-21", "en")).toBe("Thursday, May 21, 2026");
  });

  it("formats the Open Doors date in French", () => {
    expect(formatWaiverDate("2026-05-21", "fr")).toBe("jeudi 21 mai 2026");
  });

  it("maps weekday and month indices correctly for another date", () => {
    // 2026-06-06 is a Saturday.
    expect(formatWaiverDate("2026-06-06", "en")).toBe("Saturday, June 6, 2026");
    expect(formatWaiverDate("2026-06-06", "fr")).toBe("samedi 6 juin 2026");
  });

  it("returns null for absent input", () => {
    expect(formatWaiverDate(null, "en")).toBeNull();
    expect(formatWaiverDate("", "fr")).toBeNull();
  });
});
