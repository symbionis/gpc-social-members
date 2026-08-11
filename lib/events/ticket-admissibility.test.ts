import { describe, it, expect } from "vitest";
import {
  ADMISSIBLE_SLOT_STATUSES,
  partitionByCancellation,
  seatsForRegistration,
} from "@/lib/events/ticket-admissibility";

describe("ADMISSIBLE_SLOT_STATUSES", () => {
  // An allowlist, not a negation of 'claimed'. tickets_slot_status_check still permits the
  // legacy 'unclaimed' value, and on a surface governing admission an unrecognized status
  // must fall OFF the roster rather than onto it as an anonymous tickable line.
  it("admits issued and claimed only", () => {
    expect([...ADMISSIBLE_SLOT_STATUSES]).toEqual(["issued", "claimed"]);
    expect([...ADMISSIBLE_SLOT_STATUSES]).not.toContain("unclaimed");
  });
});

describe("partitionByCancellation", () => {
  it("keeps live tickets and tallies cancelled ones per booking", () => {
    const { live, cancelledByRegistration } = partitionByCancellation([
      { registration_id: "reg-1", cancellation_status: null },
      { registration_id: "reg-1", cancellation_status: "refunded" },
      { registration_id: "reg-2", cancellation_status: "requested" },
      { registration_id: "reg-2", cancellation_status: null },
    ]);

    expect(live).toHaveLength(2);
    expect(cancelledByRegistration.get("reg-1")).toBe(1);
    expect(cancelledByRegistration.get("reg-2")).toBe(1);
  });

  // A refund REQUESTED but not yet processed is already rejected at the scan, so it is not
  // admissible — the door must not be handed a line it cannot let through.
  it("treats a requested cancellation as not admissible", () => {
    const { live } = partitionByCancellation([
      { registration_id: "reg-1", cancellation_status: "requested" },
    ]);
    expect(live).toHaveLength(0);
  });

  // These surfaces govern door admission: an absent column must fail toward showing a real
  // ticket-holder, never toward silently emptying the roster.
  it("counts a missing cancellation_status as live", () => {
    const { live } = partitionByCancellation([
      { registration_id: "reg-1" },
      { registration_id: "reg-2", cancellation_status: undefined },
    ]);
    expect(live).toHaveLength(2);
  });

  it("ignores a cancelled ticket with no booking to attribute it to", () => {
    const { live, cancelledByRegistration } = partitionByCancellation([
      { registration_id: null, cancellation_status: "refunded" },
    ]);
    expect(live).toHaveLength(0);
    expect(cancelledByRegistration.size).toBe(0);
  });
});

describe("seatsForRegistration", () => {
  it("nets cancellations off the booked quantity", () => {
    const cancelled = new Map([["reg-1", 1]]);
    expect(seatsForRegistration({ id: "reg-1", quantity: 2 }, cancelled)).toBe(1);
  });

  it("returns the full quantity when nothing was cancelled", () => {
    expect(seatsForRegistration({ id: "reg-1", quantity: 3 }, new Map())).toBe(3);
  });

  it("returns zero for a fully cancelled booking", () => {
    const cancelled = new Map([["reg-1", 1]]);
    expect(seatsForRegistration({ id: "reg-1", quantity: 1 }, cancelled)).toBe(0);
  });

  // Broken data, but a negative would propagate into padding loops and headcounts.
  it("never goes negative", () => {
    const cancelled = new Map([["reg-1", 5]]);
    expect(seatsForRegistration({ id: "reg-1", quantity: 2 }, cancelled)).toBe(0);
  });

  it("treats a null quantity as zero", () => {
    expect(seatsForRegistration({ id: "reg-1", quantity: null }, new Map())).toBe(0);
  });
});
