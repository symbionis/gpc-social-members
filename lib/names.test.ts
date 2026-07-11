import { describe, it, expect } from "vitest";
import { isFullName, joinName, normalizeName, splitName } from "@/lib/names";

describe("isFullName", () => {
  it("rejects the one-word names that started this", () => {
    // Real entries from the door roster: filed under no surname, so unfindable.
    expect(isFullName("Hallf")).toBe(false);
    expect(isFullName("Mercier")).toBe(false);
    expect(isFullName("  Reguiga  ")).toBe(false);
  });

  it("accepts a first and last name", () => {
    expect(isFullName("Louisa Mercier")).toBe(true);
  });

  it("accepts a multi-part name without trying to parse it", () => {
    // The rule is "has more than one part", not "has exactly two" — a name like this
    // must not be rejected just because it doesn't fit a Western first/last shape.
    expect(isFullName("Mohd Fahmi bin Mohd Ariff")).toBe(true);
    expect(isFullName("van der Berg")).toBe(true);
  });

  it("is not fooled by padding or double spaces", () => {
    expect(isFullName("   ")).toBe(false);
    expect(isFullName("Ann   Ace")).toBe(true);
  });
});

describe("joinName", () => {
  it("joins and collapses whitespace", () => {
    expect(joinName("Louisa", "Mercier")).toBe("Louisa Mercier");
    expect(joinName("  Ann  Marie ", "  Ace ")).toBe("Ann Marie Ace");
  });

  it("yields just the one part when the other is blank (a child's name)", () => {
    expect(joinName("Emma", "")).toBe("Emma");
    expect(isFullName(joinName("Emma", ""))).toBe(false);
  });
});

describe("splitName", () => {
  it("takes the last part as the surname", () => {
    expect(splitName("Louisa Mercier")).toEqual({ first: "Louisa", last: "Mercier" });
    expect(splitName("Ann Marie Ace")).toEqual({ first: "Ann Marie", last: "Ace" });
  });

  it("puts a lone word in the first name, leaving no surname", () => {
    expect(splitName("Hallf")).toEqual({ first: "Hallf", last: "" });
  });

  it("handles an empty string", () => {
    expect(splitName("")).toEqual({ first: "", last: "" });
  });
});

describe("normalizeName", () => {
  it("collapses runs of whitespace", () => {
    expect(normalizeName(" Ann   Marie  Lead ")).toBe("Ann Marie Lead");
  });
});
