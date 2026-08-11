import { describe, it, expect } from "vitest";
import {
  redactPathForAnalytics,
  redactUrlForAnalytics,
} from "./redact-path";

const TOKEN = "abc123XYZ_-tok";

describe("redactPathForAnalytics", () => {
  it("redacts a bare offer path", () => {
    expect(redactPathForAnalytics("/public/offers/abc123XYZ_-tok")).toBe(
      "/public/offers/[token]"
    );
  });

  it("redacts an offer path with a trailing sub-path", () => {
    expect(redactPathForAnalytics("/public/offers/abc123/anything")).toBe(
      "/public/offers/[token]/anything"
    );
  });

  it("leaves non-offer paths unchanged", () => {
    expect(redactPathForAnalytics("/public/events/some-id")).toBe(
      "/public/events/some-id"
    );
    expect(redactPathForAnalytics("/dashboard")).toBe("/dashboard");
  });

  it("leaves the bare offers root unchanged (no token segment to redact)", () => {
    expect(redactPathForAnalytics("/public/offers")).toBe("/public/offers");
  });
});

describe("redactUrlForAnalytics", () => {
  it("redacts the token from the offer landing's own URL", () => {
    expect(
      redactUrlForAnalytics(`https://members.example.com/public/offers/${TOKEN}`)
    ).toBe("https://members.example.com/public/offers/[token]");
  });

  // The leak this function exists for: on a members-only event the landing
  // redirects a signed-out visitor to /login?next=<offer path> (AE8), so the
  // live token rides in the query string of a page whose path is innocuous.
  it("redacts the token from a ?next= sign-in round trip", () => {
    const url = redactUrlForAnalytics(
      `https://members.example.com/login?next=${encodeURIComponent(
        `/public/offers/${TOKEN}`
      )}`
    );
    expect(url).not.toContain(TOKEN);
    expect(decodeURIComponent(url)).toBe(
      "https://members.example.com/login?next=/public/offers/[token]"
    );
  });

  it("redacts an offer path from any query parameter, not just next", () => {
    const url = redactUrlForAnalytics(
      `https://members.example.com/login?redirect_to=/public/offers/${TOKEN}`
    );
    expect(url).not.toContain(TOKEN);
  });

  it("preserves other query parameters", () => {
    const url = redactUrlForAnalytics(
      `https://members.example.com/login?next=/public/offers/${TOKEN}&utm_source=email`
    );
    expect(url).toContain("utm_source=email");
    expect(url).not.toContain(TOKEN);
  });

  it("leaves URLs with no offer path unchanged", () => {
    expect(
      redactUrlForAnalytics("https://members.example.com/dashboard?tab=events")
    ).toBe("https://members.example.com/dashboard?tab=events");
  });

  it("redacts rather than throws on a URL that will not parse", () => {
    const malformed = `not a url /public/offers/${TOKEN}`;
    const out = redactUrlForAnalytics(malformed);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("/public/offers/[token]");
  });

  it("redacts the percent-encoded form when the URL will not parse", () => {
    const malformed = `://broken?next=%2Fpublic%2Foffers%2F${TOKEN}`;
    expect(redactUrlForAnalytics(malformed)).not.toContain(TOKEN);
  });
});
