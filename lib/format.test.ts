import { describe, it, expect } from "vitest";
import { formatMonth } from "@/lib/format";

describe("formatMonth", () => {
  it("formats a YYYY-MM key as 'Month YYYY'", () => {
    expect(formatMonth("2026-05")).toBe("May 2026");
    expect(formatMonth("2026-12")).toBe("December 2026");
    expect(formatMonth("2026-01")).toBe("January 2026");
  });
});
