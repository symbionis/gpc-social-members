import { describe, it, expect } from "vitest";
import {
  WAIVER_VERSION,
  computeWaiverVersion,
  getWaiver,
  type Waiver,
  type WaiverLanguage,
} from "@/lib/events/waiver";

describe("getWaiver", () => {
  it.each<WaiverLanguage>(["fr", "en"])(
    "returns non-empty title, subtitle, intro and clauses for %s",
    (lang) => {
      const w = getWaiver(lang);
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.subtitle.length).toBeGreaterThan(0);
      expect(w.intro.length).toBeGreaterThan(0);
      expect(w.clauses.length).toBeGreaterThan(0);
      for (const clause of w.clauses) {
        expect(clause.heading.length).toBeGreaterThan(0);
        expect(clause.paragraphs.length).toBeGreaterThan(0);
      }
    }
  );

  it("returns the same clause count for both languages", () => {
    expect(getWaiver("fr").clauses.length).toBe(getWaiver("en").clauses.length);
  });
});

describe("WAIVER_VERSION", () => {
  it("is a non-empty, content-derived string", () => {
    expect(typeof WAIVER_VERSION).toBe("string");
    expect(WAIVER_VERSION.length).toBeGreaterThan(0);
    expect(WAIVER_VERSION.startsWith("open-doors-2026-")).toBe(true);
  });

  it("changes when any waiver body text changes", () => {
    const current = { fr: getWaiver("fr"), en: getWaiver("en") };
    const stable = computeWaiverVersion(current);
    expect(stable).toBe(WAIVER_VERSION);

    // Simulate an edit to the EN text without bumping any constant by hand.
    const edited: Record<WaiverLanguage, Waiver> = {
      fr: current.fr,
      en: {
        ...current.en,
        clauses: current.en.clauses.map((c, i) =>
          i === 0 ? { ...c, paragraphs: [...c.paragraphs, "Extra clause text."] } : c
        ),
      },
    };
    expect(computeWaiverVersion(edited)).not.toBe(WAIVER_VERSION);
  });
});
