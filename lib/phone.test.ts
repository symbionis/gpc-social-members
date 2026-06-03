import { describe, it, expect } from "vitest";
import {
  toE164,
  isValidPhone,
  parseE164,
  countryOptions,
  PINNED_COUNTRIES,
} from "./phone";

describe("toE164", () => {
  it("strips the trunk zero for CH/FR/DE/UK", () => {
    // The leading 0 of the national number is dropped in E.164 for these countries.
    expect(toE164("078 123 45 67", "CH")).toBe("+41781234567");
    expect(toE164("06 12 34 56 78", "FR")).toBe("+33612345678");
    expect(toE164("030 12345678", "DE")).toBe("+493012345678");
    expect(toE164("07911 123456", "GB")).toBe("+447911123456");
  });

  it("keeps the internal leading zero for Italian numbers", () => {
    // The whole point of using libphonenumber: a blanket /^0/ strip would corrupt
    // this. The 0 after the +39 country code must be preserved.
    expect(toE164("06 6982 1234", "IT")).toBe("+390669821234");
  });

  it("handles Spanish numbers (no trunk zero)", () => {
    expect(toE164("612 34 56 78", "ES")).toBe("+34612345678");
  });

  it("returns null for an invalid or empty number", () => {
    expect(toE164("12", "CH")).toBeNull();
    expect(toE164("", "CH")).toBeNull();
    expect(toE164("   ", "CH")).toBeNull();
  });
});

describe("isValidPhone", () => {
  it("is true for a valid number and false otherwise", () => {
    expect(isValidPhone("078 123 45 67", "CH")).toBe(true);
    expect(isValidPhone("12", "CH")).toBe(false);
  });
});

describe("parseE164", () => {
  it("splits a stored E.164 value back into country + national, preserving the IT zero", () => {
    expect(parseE164("+390668212345")).toEqual({
      country: "IT",
      national: "0668212345",
    });
  });

  it("round-trips a CH number through toE164 then parseE164", () => {
    const e164 = toE164("078 123 45 67", "CH");
    expect(e164).toBe("+41781234567");
    expect(parseE164(e164)).toEqual({ country: "CH", national: "781234567" });
  });

  it("returns null for null, empty, or unparseable input", () => {
    expect(parseE164(null)).toBeNull();
    expect(parseE164(undefined)).toBeNull();
    expect(parseE164("")).toBeNull();
    expect(parseE164("not a phone")).toBeNull();
  });
});

describe("countryOptions", () => {
  it("lists FR/CH/UK/DE/IT/ES first in that order", () => {
    const opts = countryOptions();
    expect(opts.slice(0, 6).map((o) => o.country)).toEqual(PINNED_COUNTRIES);
  });

  it("carries the calling code for each country", () => {
    const ch = countryOptions().find((o) => o.country === "CH");
    expect(ch?.callingCode).toBe("+41");
  });

  it("includes every country exactly once", () => {
    const opts = countryOptions();
    const seen = new Set(opts.map((o) => o.country));
    expect(seen.size).toBe(opts.length);
    expect(opts.length).toBeGreaterThan(200);
  });
});
