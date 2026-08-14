import { describe, it, expect } from "vitest";
import {
  DEFAULT_BOOKING_LIMIT,
  ABSOLUTE_MAX_TICKETS,
  PENDING_TOPUP_WINDOW_MINUTES,
  resolveBookingLimit,
  rateClassForRegistration,
  countLiveTickets,
  resolveRemainingAllowance,
} from "@/lib/events/booking-limits";
import { createAdminClient } from "@/lib/supabase/admin";

describe("resolveBookingLimit", () => {
  const unset = { max_tickets_member: null, max_tickets_invite: null, max_tickets_non_member: null };

  it("unset columns resolve to the default for each rate class", () => {
    expect(resolveBookingLimit(unset, "member")).toBe(DEFAULT_BOOKING_LIMIT);
    expect(resolveBookingLimit(unset, "invite")).toBe(DEFAULT_BOOKING_LIMIT);
    expect(resolveBookingLimit(unset, "non_member")).toBe(DEFAULT_BOOKING_LIMIT);
  });

  it("a configured value resolves to itself", () => {
    expect(
      resolveBookingLimit({ ...unset, max_tickets_invite: 4 }, "invite")
    ).toBe(4);
  });

  it("clamps a configured value above the absolute ceiling (defense-in-depth past the DB CHECK)", () => {
    expect(
      resolveBookingLimit({ ...unset, max_tickets_invite: 25 }, "invite")
    ).toBe(ABSOLUTE_MAX_TICKETS);
  });

  it("treats a stored 0 or negative value as unset rather than trusting it", () => {
    expect(resolveBookingLimit({ ...unset, max_tickets_member: 0 }, "member")).toBe(
      DEFAULT_BOOKING_LIMIT
    );
    expect(
      resolveBookingLimit({ ...unset, max_tickets_member: -3 }, "member")
    ).toBe(DEFAULT_BOOKING_LIMIT);
  });
});

describe("rateClassForRegistration", () => {
  it("a member registration on a members-only event resolves to member", () => {
    expect(
      rateClassForRegistration(
        { is_member: true, is_guest_list: false },
        { visibility: "members_only" }
      )
    ).toBe("member");
  });

  it("a non-member registration on a members-only event resolves to invite", () => {
    expect(
      rateClassForRegistration(
        { is_member: false, is_guest_list: false },
        { visibility: "members_only" }
      )
    ).toBe("invite");
  });

  it("a non-member registration on a public event resolves to non_member", () => {
    expect(
      rateClassForRegistration(
        { is_member: false, is_guest_list: false },
        { visibility: "public" }
      )
    ).toBe("non_member");
  });

  it("R11: a comp guest-list registration resolves to member, not invite, even on a members-only event", () => {
    expect(
      rateClassForRegistration(
        { is_member: false, is_guest_list: true },
        { visibility: "members_only" }
      )
    ).toBe("member");
  });
});

// Chainable mock mirroring the shape used across app/api/*/route.test.ts: `.then` resolves a
// list query, `.maybeSingle` resolves a single-row query, and a head-count select resolves via
// `.then` returning `{count, error}`.
function mockSupabase(opts: {
  items?: { quantity: number }[];
  regQuantity?: number;
  pendingTopups?: { items: { quantity: number }[] }[];
  cancelledCount?: number;
  errorOn?: "items" | "registration" | "topups" | "tickets";
  /** Records every `.gte(col, value)` call on the "event_registration_topups" query, so a
   *  test can assert the reservation-window cutoff actually reaches the query. */
  gteCalls?: [string, string][];
}) {
  return {
    from: (table: string) => {
      let headCount = false;
      const c: Record<string, unknown> = {};
      c.select = (_cols: string, sel?: { count?: string; head?: boolean }) => {
        headCount = Boolean(sel?.head);
        return c;
      };
      c.eq = () => c;
      c.gte = (col: string, value: string) => {
        if (table === "event_registration_topups") opts.gteCalls?.push([col, value]);
        return c;
      };
      c.not = () => c;
      c.limit = () => c;
      c.maybeSingle = async () => {
        if (table === "event_registrations") {
          if (opts.errorOn === "registration") {
            return { data: null, error: { message: "boom" } };
          }
          return { data: { quantity: opts.regQuantity ?? 0 }, error: null };
        }
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_registration_items") {
          if (opts.errorOn === "items") return resolve({ data: null, error: { message: "boom" } });
          return resolve({ data: opts.items ?? [], error: null });
        }
        if (table === "event_registration_topups") {
          if (opts.errorOn === "topups") return resolve({ data: null, error: { message: "boom" } });
          return resolve({ data: opts.pendingTopups ?? [], error: null });
        }
        if (table === "tickets" && headCount) {
          if (opts.errorOn === "tickets") return resolve({ count: null, error: { message: "boom" } });
          return resolve({ count: opts.cancelledCount ?? 0, error: null });
        }
        return resolve({ data: [], error: null });
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

describe("countLiveTickets", () => {
  it("returns the purchased total when nothing is cancelled or pending", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 2 }, { quantity: 1 }] });
    expect(await countLiveTickets(supabase, "reg-1")).toBe(3);
  });

  it("R6: subtracts a cancelled ticket (requested or refunded — both are non-null cancellation_status)", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 4 }], cancelledCount: 2 });
    expect(await countLiveTickets(supabase, "reg-1")).toBe(2);
  });

  it("R12: adds quantity from a pending top-up within the reservation window", async () => {
    const supabase = mockSupabase({
      items: [{ quantity: 1 }],
      pendingTopups: [{ items: [{ quantity: 3 }] }],
    });
    expect(await countLiveTickets(supabase, "reg-1")).toBe(4);
  });

  it("falls back to event_registrations.quantity for a registration with no line items (mirrors seats_used's NOT EXISTS branch)", async () => {
    const supabase = mockSupabase({ items: [], regQuantity: 5 });
    expect(await countLiveTickets(supabase, "reg-1")).toBe(5);
  });

  it("throws when the items query errors, rather than returning a partial count", async () => {
    const supabase = mockSupabase({ errorOn: "items" });
    await expect(countLiveTickets(supabase, "reg-1")).rejects.toThrow();
  });

  it("throws when the pending top-up query errors", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 1 }], errorOn: "topups" });
    await expect(countLiveTickets(supabase, "reg-1")).rejects.toThrow();
  });

  it("throws when the cancelled-tickets query errors", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 1 }], errorOn: "tickets" });
    await expect(countLiveTickets(supabase, "reg-1")).rejects.toThrow();
  });

  it("R12: filters pending top-ups to the last 60 minutes, not older ones — the query builder receives that cutoff", async () => {
    // The mock's own .gte() doesn't filter (Postgres does that for real); this proves the
    // reservation-window cutoff actually reaches the query, which is what stops a pending row
    // that aged out of the window from still reserving allowance.
    const gteCalls: [string, string][] = [];
    const before = Date.now();
    const supabase = mockSupabase({ items: [{ quantity: 1 }], gteCalls });
    await countLiveTickets(supabase, "reg-1");
    expect(gteCalls).toHaveLength(1);
    const [col, cutoffIso] = gteCalls[0];
    expect(col).toBe("created_at");
    const cutoffMs = new Date(cutoffIso).getTime();
    const expectedCutoffMs = before - PENDING_TOPUP_WINDOW_MINUTES * 60 * 1000;
    // Allow a small tolerance for the time the test itself takes to run.
    expect(Math.abs(cutoffMs - expectedCutoffMs)).toBeLessThan(5000);
  });
});

describe("resolveRemainingAllowance", () => {
  const inviteEvent = {
    visibility: "members_only",
    max_tickets_member: null,
    max_tickets_invite: 4,
    max_tickets_non_member: null,
  };

  it("returns null/null for a member registration (checkout-only bound, no allowance UI)", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 2 }] });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: true, is_guest_list: false },
      inviteEvent
    );
    expect(result).toEqual({ remainingAllowance: null, bookingLimit: null });
  });

  it("returns null/null for a comp guest-list registration (R11 exemption)", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 20 }] });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: false, is_guest_list: true },
      inviteEvent
    );
    expect(result).toEqual({ remainingAllowance: null, bookingLimit: null });
  });

  it("returns null/null for a non_member registration on a public event", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 2 }] });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: false, is_guest_list: false },
      { ...inviteEvent, visibility: "public" }
    );
    expect(result).toEqual({ remainingAllowance: null, bookingLimit: null });
  });

  it("computes the remaining allowance for an invite-class registration", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 1 }] });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: false, is_guest_list: false },
      inviteEvent
    );
    expect(result).toEqual({ remainingAllowance: 3, bookingLimit: 4 });
  });

  it("floors the remaining allowance at 0 rather than going negative", async () => {
    const supabase = mockSupabase({ items: [{ quantity: 6 }] });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: false, is_guest_list: false },
      inviteEvent
    );
    expect(result).toEqual({ remainingAllowance: 0, bookingLimit: 4 });
  });

  it("fails closed: a live-ticket count error resolves to zero remaining allowance, not an unrestricted one", async () => {
    const supabase = mockSupabase({ errorOn: "items" });
    const result = await resolveRemainingAllowance(
      supabase,
      { id: "reg-1", is_member: false, is_guest_list: false },
      inviteEvent
    );
    expect(result).toEqual({ remainingAllowance: 0, bookingLimit: 4 });
  });
});
