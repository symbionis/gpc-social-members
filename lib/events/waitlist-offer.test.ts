import { describe, it, expect } from "vitest";
import {
  deriveWaitlistOfferability,
  isWaitlistEntryRedeemed,
  findRedeemingRegistration,
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

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Records the filters each query applies. The matching that used to happen in
 * `isWaitlistEntryRedeemed` now lives in the query itself, so asserting the
 * filters IS asserting the predicate — a mock that ignored them would let a
 * dropped `.eq` pass unnoticed.
 */
function fakeSupabase(responses: QueryResult[]) {
  const calls: Record<string, unknown>[] = [];
  let next = 0;
  const client = {
    from() {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        in: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        limit: () => {
          calls.push(filters);
          return Promise.resolve(
            responses[next++] ?? { data: [], error: null }
          );
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

const ROW = { waitlist_entry_id: "wl-1", email: "a@x.com", reference_code: "REF1" };

describe("findRedeemingRegistration", () => {
  it("returns the linked registration and does not fall through to the email query", async () => {
    const { client, calls } = fakeSupabase([{ data: [ROW], error: null }]);
    const { data, error } = await findRedeemingRegistration(client, "ev-1", {
      id: "wl-1",
      email: "a@x.com",
    });

    expect(error).toBeNull();
    expect(data).toEqual(ROW);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      event_id: "ev-1",
      waitlist_entry_id: "wl-1",
      status: ["paid", "free"],
    });
  });

  it("falls back to a normalised email match for a legacy entry with no link", async () => {
    const { client, calls } = fakeSupabase([
      { data: [], error: null },
      { data: [{ ...ROW, waitlist_entry_id: null }], error: null },
    ]);
    const { data } = await findRedeemingRegistration(client, "ev-1", {
      id: "wl-1",
      email: "  A@X.com  ",
    });

    expect(data?.reference_code).toBe("REF1");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ event_id: "ev-1", email: "a@x.com" });
  });

  it("returns null when neither the link nor the email matches", async () => {
    const { client } = fakeSupabase([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const { data, error } = await findRedeemingRegistration(client, "ev-1", {
      id: "wl-1",
      email: "a@x.com",
    });

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  // Fail closed: a caller that read a swallowed error as "not redeemed" would send
  // someone who already holds a ticket back to checkout.
  it("propagates a link-query error without running the email query", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "boom" } },
    ]);
    const { data, error } = await findRedeemingRegistration(client, "ev-1", {
      id: "wl-1",
      email: "a@x.com",
    });

    expect(data).toBeNull();
    expect(error).toEqual({ message: "boom" });
    expect(calls).toHaveLength(1);
  });

  it("propagates an email-query error", async () => {
    const { client } = fakeSupabase([
      { data: [], error: null },
      { data: null, error: { message: "boom" } },
    ]);
    const { error } = await findRedeemingRegistration(client, "ev-1", {
      id: "wl-1",
      email: "a@x.com",
    });

    expect(error).toEqual({ message: "boom" });
  });
});
