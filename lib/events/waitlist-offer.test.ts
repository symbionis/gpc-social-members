import { describe, it, expect } from "vitest";
import {
  deriveWaitlistOfferability,
  isWaitlistEntryRedeemed,
} from "@/lib/events/waitlist-offer";

const liveType = { title: "Standard", archived_at: null, counts_as_seat: true };

describe("deriveWaitlistOfferability", () => {
  it("is offerable for a live seat-counting type and an in-range quantity", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: "tt-1",
      quantity: 3,
      ticketType: liveType,
    });
    expect(result.offerable).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("flags a null ticket type, naming the missing type", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: null,
      quantity: 2,
      ticketType: null,
    });
    expect(result.offerable).toBe(false);
    expect(result.reason).toMatch(/ticket type/i);
  });

  it("flags a dangling ticket_type_id (no matching row)", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: "tt-gone",
      quantity: 2,
      ticketType: null,
    });
    expect(result.offerable).toBe(false);
    expect(result.reason).toMatch(/no longer exists/i);
  });

  it("flags an archived type, naming it in the reason", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: "tt-1",
      quantity: 2,
      ticketType: { title: "VIP", archived_at: "2026-01-01T00:00:00Z", counts_as_seat: true },
    });
    expect(result.offerable).toBe(false);
    expect(result.reason).toContain("VIP");
    expect(result.reason).toMatch(/archived/i);
  });

  it("flags a type that does not count as a seat, naming it in the reason", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: "tt-1",
      quantity: 2,
      ticketType: { title: "Parking", archived_at: null, counts_as_seat: false },
    });
    expect(result.offerable).toBe(false);
    expect(result.reason).toContain("Parking");
  });

  it("flags a null quantity", () => {
    const result = deriveWaitlistOfferability({
      ticket_type_id: "tt-1",
      quantity: null,
      ticketType: liveType,
    });
    expect(result.offerable).toBe(false);
    expect(result.reason).toMatch(/quantity/i);
  });

  it("flags quantity 0 and quantity 11 as out of range", () => {
    expect(
      deriveWaitlistOfferability({ ticket_type_id: "tt-1", quantity: 0, ticketType: liveType })
        .offerable
    ).toBe(false);
    expect(
      deriveWaitlistOfferability({ ticket_type_id: "tt-1", quantity: 11, ticketType: liveType })
        .offerable
    ).toBe(false);
  });
});

describe("isWaitlistEntryRedeemed", () => {
  it("is redeemed when a live registration links back via waitlist_entry_id", () => {
    const redeemed = isWaitlistEntryRedeemed(
      { id: "wl-1", email: "a@x.com" },
      [{ waitlist_entry_id: "wl-1", email: "someone-else@x.com" }]
    );
    expect(redeemed).toBe(true);
  });

  it("falls back to an email match for a legacy entry with no link", () => {
    const redeemed = isWaitlistEntryRedeemed(
      { id: "wl-1", email: "A@X.com" },
      [{ waitlist_entry_id: null, email: "a@x.com" }]
    );
    expect(redeemed).toBe(true);
  });

  it("is not redeemed when neither the link nor the email matches", () => {
    const redeemed = isWaitlistEntryRedeemed(
      { id: "wl-1", email: "a@x.com" },
      [{ waitlist_entry_id: "wl-2", email: "b@x.com" }]
    );
    expect(redeemed).toBe(false);
  });

  it("a registration linked to a different entry does not redeem this one, even if unrelated", () => {
    const redeemed = isWaitlistEntryRedeemed(
      { id: "wl-1", email: "unique@x.com" },
      [{ waitlist_entry_id: "wl-9", email: "different@x.com" }]
    );
    expect(redeemed).toBe(false);
  });
});
