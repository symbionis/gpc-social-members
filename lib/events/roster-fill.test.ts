import { describe, it, expect } from "vitest";
import {
  computePartyFills,
  rosterGuestSummary,
  type RosterAttendeeInput,
} from "@/lib/events/roster-fill";

function lead(regId: string, over: Partial<RosterAttendeeInput> = {}): RosterAttendeeInput {
  return {
    id: `lead-${regId}`,
    registration_id: regId,
    name: "Lead",
    email: "lead@x.ch",
    phone_e164: "",
    is_lead: true,
    waiver_accepted_at: null,
    checked_in_at: null,
    ...over,
  };
}
function guest(regId: string, id: string, over: Partial<RosterAttendeeInput> = {}): RosterAttendeeInput {
  return {
    id,
    registration_id: regId,
    name: `Guest ${id}`,
    email: `${id}@x.ch`,
    phone_e164: "",
    is_lead: false,
    waiver_accepted_at: null,
    checked_in_at: null,
    ...over,
  };
}

describe("computePartyFills", () => {
  it("counts the lead + claimed guests against quantity", () => {
    const fills = computePartyFills(
      [{ id: "r1", quantity: 6 }],
      [lead("r1"), guest("r1", "g1"), guest("r1", "g2")]
    );
    const f = fills.get("r1")!;
    expect(f).toMatchObject({ quantity: 6, claimedCount: 3, remaining: 3, complete: false });
    expect(f.guests.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("lead only → 1 of N, no guests", () => {
    const f = computePartyFills([{ id: "r1", quantity: 6 }], [lead("r1")]).get("r1")!;
    expect(f).toMatchObject({ quantity: 6, claimedCount: 1, remaining: 5, complete: false });
    expect(f.guests).toEqual([]);
  });

  it("claimed equals quantity → 0 remaining, complete", () => {
    const f = computePartyFills(
      [{ id: "r1", quantity: 2 }],
      [lead("r1"), guest("r1", "g1")]
    ).get("r1")!;
    expect(f).toMatchObject({ claimedCount: 2, remaining: 0, complete: true });
  });

  it("never reports negative remaining when over-claimed", () => {
    const f = computePartyFills(
      [{ id: "r1", quantity: 1 }],
      [lead("r1"), guest("r1", "g1")]
    ).get("r1")!;
    expect(f.remaining).toBe(0);
    expect(f.complete).toBe(true);
  });

  it("ignores registration-less (imported/ops) attendees", () => {
    const fills = computePartyFills(
      [{ id: "r1", quantity: 2 }],
      [lead("r1"), { ...guest("r1", "imported"), registration_id: null }]
    );
    expect(fills.get("r1")!.claimedCount).toBe(1);
  });

  it("carries each guest's waiver + arrival flags", () => {
    const f = computePartyFills(
      [{ id: "r1", quantity: 3 }],
      [
        lead("r1"),
        guest("r1", "g1", { waiver_accepted_at: "2026-06-01T09:00:00Z", checked_in_at: "2026-06-06T18:00:00Z" }),
      ]
    ).get("r1")!;
    expect(f.guests[0]).toMatchObject({
      waiverSigned: true,
      checkedIn: true,
      arrivedAt: "2026-06-06T18:00:00Z",
    });
  });
});

describe("rosterGuestSummary", () => {
  it("counts all claimed attendees against total tickets", () => {
    const summary = rosterGuestSummary(
      [{ id: "r1", quantity: 6 }, { id: "r2", quantity: 2 }],
      [lead("r1"), guest("r1", "g1"), lead("r2")]
    );
    expect(summary).toEqual({ registered: 3, total: 8 });
  });
});
