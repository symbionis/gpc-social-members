import { describe, it, expect } from "vitest";
import { stripHtml } from "@/lib/broadcast/strip-html";

describe("stripHtml", () => {
  it("strips tags and trims", () => {
    expect(stripHtml("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
  });

  it("removes <style> and <script> blocks entirely", () => {
    expect(stripHtml("<style>p{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(stripHtml("<script>alert(1)</script><p>Hi</p>")).toBe("Hi");
  });

  it("converts <br> and </p> to line breaks", () => {
    expect(stripHtml("Line one<br/>Line two")).toBe("Line one\nLine two");
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });

  it("decodes the common HTML entities", () => {
    expect(stripHtml("a &amp; b &lt;c&gt; &quot;d&quot;&nbsp;e")).toBe('a & b <c> "d" e');
  });

  it("collapses runs of 3+ newlines to a blank line", () => {
    expect(stripHtml("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});
