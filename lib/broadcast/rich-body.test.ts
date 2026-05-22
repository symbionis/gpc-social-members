import { describe, it, expect } from "vitest";
import { normalizeRichBody } from "@/lib/broadcast/rich-body";

describe("normalizeRichBody", () => {
  it("returns falsy input unchanged", () => {
    expect(normalizeRichBody("")).toBe("");
  });

  it("gives empty paragraphs a non-breaking space so they keep their height", () => {
    expect(normalizeRichBody("<p>a</p><p></p><p>b</p>")).toBe(
      "<p>a</p><p>&nbsp;</p><p>b</p>"
    );
  });

  it("treats whitespace-only and lone-<br> paragraphs as blank-line spacers", () => {
    expect(normalizeRichBody("<p>a</p><p> </p><p>b</p>")).toBe(
      "<p>a</p><p>&nbsp;</p><p>b</p>"
    );
    expect(normalizeRichBody("<p>a</p><p><br></p><p>b</p>")).toBe(
      "<p>a</p><p>&nbsp;</p><p>b</p>"
    );
    expect(normalizeRichBody("<p>a</p><p><br/></p><p>b</p>")).toBe(
      "<p>a</p><p>&nbsp;</p><p>b</p>"
    );
  });

  it("collapses a run of multiple empty paragraphs to a single blank line", () => {
    expect(normalizeRichBody("<p>a</p><p></p><p></p><p></p><p>b</p>")).toBe(
      "<p>a</p><p>&nbsp;</p><p>b</p>"
    );
  });

  it("leaves consecutive content paragraphs tight (no spacer inserted)", () => {
    expect(normalizeRichBody("<p>Line one.</p><p>Line two.</p>")).toBe(
      "<p>Line one.</p><p>Line two.</p>"
    );
  });

  it("preserves paragraphs containing inline markup", () => {
    expect(normalizeRichBody("<p><em>President</em> </p>")).toBe(
      "<p><em>President</em> </p>"
    );
  });

  it("normalises the real Open Doors send: tight pairs kept, blanks preserved, double-blank collapsed", () => {
    const input =
      "<p>Dear Guests,</p><p></p><p>Thank you.</p><p>We saw smiles.</p>" +
      "<p></p><p>Coast</p><p><em>President</em> </p><p></p><p></p><p>Links</p>";
    expect(normalizeRichBody(input)).toBe(
      "<p>Dear Guests,</p><p>&nbsp;</p><p>Thank you.</p><p>We saw smiles.</p>" +
        "<p>&nbsp;</p><p>Coast</p><p><em>President</em> </p><p>&nbsp;</p><p>Links</p>"
    );
  });

  it("is idempotent — already-normalised input is unchanged", () => {
    const once = normalizeRichBody("<p>a</p><p></p><p></p><p>b</p>");
    expect(normalizeRichBody(once)).toBe(once);
  });
});
