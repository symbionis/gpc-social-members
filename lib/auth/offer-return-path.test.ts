import { describe, it, expect } from "vitest";
import { safeOfferReturnPath } from "./offer-return-path";

describe("safeOfferReturnPath", () => {
  it("accepts a same-origin relative offer path", () => {
    expect(safeOfferReturnPath("/public/offers/abc123")).toBe("/public/offers/abc123");
  });

  it("accepts an offer path carrying its own query string", () => {
    expect(safeOfferReturnPath("/public/offers/abc123?foo=bar")).toBe(
      "/public/offers/abc123?foo=bar"
    );
  });

  it("falls back to null for an absolute URL", () => {
    expect(safeOfferReturnPath("https://evil.example/public/offers/abc123")).toBeNull();
  });

  it("falls back to null for a protocol-relative URL", () => {
    expect(safeOfferReturnPath("//evil.example/public/offers/abc123")).toBeNull();
  });

  it("falls back to null for a backslash-prefixed path", () => {
    expect(safeOfferReturnPath("/\\evil.example/public/offers/abc123")).toBeNull();
  });

  it("falls back to null for a javascript: scheme", () => {
    expect(safeOfferReturnPath("javascript:alert(1)")).toBeNull();
  });

  it("falls back to null for a path outside the offer landing", () => {
    expect(safeOfferReturnPath("/admin/dashboard")).toBeNull();
  });

  it("falls back to null for the bare prefix with no token", () => {
    expect(safeOfferReturnPath("/public/offers/")).toBeNull();
  });

  it("falls back to null for null, undefined, and empty string", () => {
    expect(safeOfferReturnPath(null)).toBeNull();
    expect(safeOfferReturnPath(undefined)).toBeNull();
    expect(safeOfferReturnPath("")).toBeNull();
  });
});
