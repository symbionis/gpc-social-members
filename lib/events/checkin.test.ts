import { describe, it, expect } from "vitest";
import { normalizeEmail, resolveMatch, isUniqueViolation } from "@/lib/events/checkin";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jean@X.CH ")).toBe("jean@x.ch");
  });
});

describe("resolveMatch", () => {
  const reg = { id: "reg-1", email: "alice@example.com" };
  const member = { id: "mem-1", email: "bob@example.com" };

  it("matches a registration -> registered (AE1)", () => {
    expect(resolveMatch("alice@example.com", [reg], [])).toEqual({
      kind: "registered",
      registrationId: "reg-1",
    });
  });

  it("matches an active member with no registration -> member (AE3)", () => {
    expect(resolveMatch("bob@example.com", [], [member])).toEqual({
      kind: "member",
      memberId: "mem-1",
    });
  });

  it("matches neither -> guest", () => {
    expect(resolveMatch("nobody@example.com", [reg], [member])).toEqual({
      kind: "guest",
    });
  });

  it("matches case-insensitively on both legs (eq-vs-ilike regression guard)", () => {
    const mixedReg = { id: "reg-2", email: "Jean@X.ch" };
    const mixedMember = { id: "mem-2", email: "MARIE@x.CH" };
    expect(resolveMatch("  JEAN@x.ch ", [mixedReg], [])).toEqual({
      kind: "registered",
      registrationId: "reg-2",
    });
    expect(resolveMatch("marie@x.ch", [], [mixedMember])).toEqual({
      kind: "member",
      memberId: "mem-2",
    });
  });

  it("registration wins when an email matches both (precedence)", () => {
    const both = "dual@example.com";
    expect(
      resolveMatch(
        both,
        [{ id: "reg-3", email: both }],
        [{ id: "mem-3", email: both }]
      )
    ).toEqual({ kind: "registered", registrationId: "reg-3" });
  });

  it("tolerates null emails in candidate rows", () => {
    expect(
      resolveMatch("x@y.z", [{ id: "r", email: null }], [{ id: "m", email: null }])
    ).toEqual({ kind: "guest" });
  });
});

describe("isUniqueViolation", () => {
  it("treats 23505 as a unique violation (already checked in -> AE4)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("is false for other / missing codes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});
