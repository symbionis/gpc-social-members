import { describe, it, expect } from "vitest";
import { redactPathForAnalytics } from "./redact-path";

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
