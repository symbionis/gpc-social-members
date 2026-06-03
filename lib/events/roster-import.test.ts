import { describe, it, expect } from "vitest";
import { parseImportRows } from "@/lib/events/roster-import";

describe("parseImportRows", () => {
  it("parses a clean batch of name,country,phone,email rows", () => {
    const text = [
      "Jane Doe, CH, 078 123 45 67, jane@example.com",
      "Marco Rossi, IT, 06 1234 5678, marco@example.it",
    ].join("\n");
    const { rows, errors } = parseImportRows(text);

    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      line: 1,
      name: "Jane Doe",
      country: "CH",
      phone: "078 123 45 67",
      email: "jane@example.com",
    });
    expect(rows[1]).toMatchObject({ name: "Marco Rossi", country: "IT" });
  });

  it("flags a row with neither phone nor email as an error", () => {
    const { rows, errors } = parseImportRows("Jane Doe, CH");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 1, reason: "Needs a phone or an email" });
  });

  it("flags a row with only a name as an error", () => {
    const { rows, errors } = parseImportRows("Jane Doe");
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toBe("Needs a phone or an email");
  });

  it("ignores blank lines (and all-whitespace lines) without erroring", () => {
    const text = [
      "Jane Doe, CH, 078 123 45 67",
      "",
      "   ",
      "John Roe, FR, , john@example.fr",
    ].join("\n");
    const { rows, errors } = parseImportRows(text);

    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    // The two valid rows keep their original line numbers (1 and 4).
    expect(rows[0].line).toBe(1);
    expect(rows[1].line).toBe(4);
  });

  it("accepts an email-only row (no phone, no country needed)", () => {
    const { rows, errors } = parseImportRows("Email Only, , , solo@example.com");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Email Only",
      country: "",
      phone: "",
      email: "solo@example.com",
    });
  });

  it("tolerates trailing whitespace and lowercases the email, uppercases country", () => {
    const { rows, errors } = parseImportRows("  Jane Doe  ,  ch  ,  078 123 45 67  ,  Jane@Example.COM  ");
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      name: "Jane Doe",
      country: "CH",
      phone: "078 123 45 67",
      email: "jane@example.com",
    });
  });

  it("flags a phone supplied without a country code", () => {
    const { rows, errors } = parseImportRows("Jane Doe, , 078 123 45 67");
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toMatch(/country/i);
  });

  it("flags an obviously invalid email", () => {
    const { rows, errors } = parseImportRows("Jane Doe, , , not-an-email");
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toMatch(/invalid email/i);
  });
});
