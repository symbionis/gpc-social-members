import { describe, it, expect } from "vitest";
import { resolvePayerTicket, type PayerCandidateTicket } from "@/lib/events/booking-redirect";

const ticket = (over: Partial<PayerCandidateTicket> = {}): PayerCandidateTicket => ({
  id: "tk-1",
  email: "payer@example.com",
  manageToken: "mtk-1",
  isLead: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("resolvePayerTicket", () => {
  it("resolves the single live ticket matching the registration's email", () => {
    const result = resolvePayerTicket("payer@example.com", [ticket()]);
    expect(result).toEqual({ id: "tk-1", manageToken: "mtk-1" });
  });

  it("is case- and whitespace-insensitive on email", () => {
    const result = resolvePayerTicket("  Payer@Example.com  ", [
      ticket({ email: "payer@example.com" }),
    ]);
    expect(result).toEqual({ id: "tk-1", manageToken: "mtk-1" });
  });

  it("picks the earliest-created ticket when the payer holds several live tickets", () => {
    const result = resolvePayerTicket("payer@example.com", [
      ticket({ id: "tk-late", manageToken: "mtk-late", createdAt: "2026-02-01T00:00:00Z" }),
      ticket({ id: "tk-early", manageToken: "mtk-early", createdAt: "2026-01-01T00:00:00Z" }),
      ticket({ id: "tk-mid", manageToken: "mtk-mid", createdAt: "2026-01-15T00:00:00Z" }),
    ]);
    expect(result).toEqual({ id: "tk-early", manageToken: "mtk-early" });
  });

  it("returns null when the payer holds no live ticket at all", () => {
    const result = resolvePayerTicket("payer@example.com", [
      ticket({ email: "someone-else@example.com" }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when the tickets list is empty (never minted)", () => {
    expect(resolvePayerTicket("payer@example.com", [])).toBeNull();
  });

  it("ignores a matching ticket that has no manage_token yet", () => {
    const result = resolvePayerTicket("payer@example.com", [ticket({ manageToken: null })]);
    expect(result).toBeNull();
  });

  it("falls back to the is_lead ticket when the registration email is blank", () => {
    const result = resolvePayerTicket("", [
      ticket({ id: "tk-guest", manageToken: "mtk-guest", email: "guest@example.com", isLead: false }),
      ticket({ id: "tk-lead", manageToken: "mtk-lead", email: null, isLead: true }),
    ]);
    expect(result).toEqual({ id: "tk-lead", manageToken: "mtk-lead" });
  });

  it("returns null on blank registration email with no is_lead ticket live", () => {
    const result = resolvePayerTicket(null, [
      ticket({ id: "tk-guest", manageToken: "mtk-guest", isLead: false }),
    ]);
    expect(result).toBeNull();
  });
});
