import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  normalizeTicketType,
  assertEventRegistrationPriceable,
} from "@/lib/events/ticket-types";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

describe("normalizeTicketType", () => {
  it("keeps member + non-member price and forces invite null on a public event", () => {
    const r = normalizeTicketType(
      { title: "Standard", price_member: 80, price_non_member: 120, invite_price: 99, counts_as_seat: true },
      "public"
    );
    expect(r).toEqual({
      ok: true,
      value: { title: "Standard", price_member: 80, price_non_member: 120, invite_price: null, counts_as_seat: true, description: null },
    });
  });

  it("keeps member + invite price and forces non-member null on a members-only event", () => {
    const r = normalizeTicketType(
      { title: "Standard", price_member: 80, price_non_member: 120, invite_price: 100 },
      "members_only"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.price_non_member).toBeNull();
      expect(r.value.invite_price).toBe(100);
      expect(r.value.counts_as_seat).toBe(true); // default
    }
  });

  it("treats empty-string prices as null", () => {
    const r = normalizeTicketType({ title: "Kids", price_member: "", price_non_member: "" }, "public");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.price_member).toBeNull();
      expect(r.value.price_non_member).toBeNull();
    }
  });

  it("respects counts_as_seat=false", () => {
    const r = normalizeTicketType({ title: "Parking", price_member: 10, counts_as_seat: false }, "public");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.counts_as_seat).toBe(false);
  });

  it("rejects a missing/blank title", () => {
    expect(normalizeTicketType({ title: "  " }, "public").ok).toBe(false);
    expect(normalizeTicketType({}, "public").ok).toBe(false);
  });

  it("rejects a negative price", () => {
    expect(normalizeTicketType({ title: "X", price_member: -1 }, "public").ok).toBe(false);
  });

  it("trims a description and returns it", () => {
    const r = normalizeTicketType(
      { title: "VIP", price_member: 80, description: "  Includes welcome drink + seated dinner  " },
      "public"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe("Includes welcome drink + seated dinner");
  });

  it("treats an empty or whitespace-only description as null", () => {
    const empty = normalizeTicketType({ title: "X", price_member: 10, description: "" }, "public");
    const blank = normalizeTicketType({ title: "X", price_member: 10, description: "   \n  " }, "public");
    expect(empty.ok && empty.value.description).toBeNull();
    expect(blank.ok && blank.value.description).toBeNull();
  });

  it("defaults an absent description to null", () => {
    const r = normalizeTicketType({ title: "X", price_member: 10 }, "public");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBeNull();
  });

  it("ignores a non-string description rather than coercing it", () => {
    const r = normalizeTicketType(
      { title: "X", price_member: 10, description: { evil: true } as unknown },
      "public"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBeNull();
  });

  it("rejects a description over the 500-character cap", () => {
    const r = normalizeTicketType(
      { title: "X", price_member: 10, description: "a".repeat(501) },
      "public"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/description/i);
  });

  it("accepts a description exactly at the 500-character cap", () => {
    const r = normalizeTicketType(
      { title: "X", price_member: 10, description: "a".repeat(500) },
      "public"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toHaveLength(500);
  });
});

// Mock chain: events.select().eq().maybeSingle() and
// event_ticket_types.select().eq().is() (awaited thenable).
function adminFor(
  event: { visibility: string } | null,
  types: { title: string; price_member: number | null; price_non_member: number | null }[] | null
) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.maybeSingle = async () => ({ data: event, error: null });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve(table === "event_ticket_types" ? { data: types, error: null } : { data: null, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

describe("assertEventRegistrationPriceable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when the event has no active types", async () => {
    mockedAdmin.mockReturnValue(adminFor({ visibility: "public" }, []));
    const r = await assertEventRegistrationPriceable("evt");
    expect(r.ok).toBe(false);
  });

  it("rejects a public event whose type lacks a non-member price", async () => {
    mockedAdmin.mockReturnValue(
      adminFor({ visibility: "public" }, [{ title: "Standard", price_member: 80, price_non_member: null }])
    );
    const r = await assertEventRegistrationPriceable("evt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-member price/i);
  });

  it("rejects any event whose type lacks a member price", async () => {
    mockedAdmin.mockReturnValue(
      adminFor({ visibility: "members_only" }, [{ title: "Standard", price_member: null, price_non_member: null }])
    );
    const r = await assertEventRegistrationPriceable("evt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/member price/i);
  });

  it("passes a members-only event with a member-priced type (non-member null is fine)", async () => {
    mockedAdmin.mockReturnValue(
      adminFor({ visibility: "members_only" }, [{ title: "Standard", price_member: 80, price_non_member: null }])
    );
    const r = await assertEventRegistrationPriceable("evt");
    expect(r.ok).toBe(true);
  });

  it("passes a public event with fully-priced types", async () => {
    mockedAdmin.mockReturnValue(
      adminFor({ visibility: "public" }, [
        { title: "Standard", price_member: 80, price_non_member: 120 },
        { title: "Kids", price_member: 40, price_non_member: 60 },
      ])
    );
    const r = await assertEventRegistrationPriceable("evt");
    expect(r.ok).toBe(true);
  });
});
