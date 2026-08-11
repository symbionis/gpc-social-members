import { describe, it, expect } from "vitest";
import { resolveOfferLandingOutcome, type ResolveOfferLandingInput } from "./offer-landing";

function baseInput(overrides: Partial<ResolveOfferLandingInput> = {}): ResolveOfferLandingInput {
  return {
    entry: { id: "entry-1", email: "waitlisted@example.com", quantity: 2 },
    event: { is_published: true, registration_enabled: true, isMembersOnly: false },
    isLoggedIn: false,
    isActiveMember: false,
    redeemedRegistration: null,
    seatsFree: 5,
    loginUrl: "/login?next=%2Fpublic%2Foffers%2Ftok",
    ...overrides,
  };
}

describe("resolveOfferLandingOutcome — six-outcome gate", () => {
  it("renders checkout on a public event with free seats", () => {
    const outcome = resolveOfferLandingOutcome(baseInput());
    expect(outcome).toEqual({ kind: "checkout", redeemableQuantity: 2 });
  });

  it("caps the redeemable quantity at seats free when fewer than the entry's quantity", () => {
    const outcome = resolveOfferLandingOutcome(baseInput({ seatsFree: 1 }));
    expect(outcome).toEqual({ kind: "checkout", redeemableQuantity: 1 });
  });

  it("treats an uncapped event (seatsFree null) as the full entry quantity", () => {
    const outcome = resolveOfferLandingOutcome(baseInput({ seatsFree: null }));
    expect(outcome).toEqual({ kind: "checkout", redeemableQuantity: 2 });
  });

  it("returns invalid when the token did not resolve to an entry", () => {
    expect(resolveOfferLandingOutcome(baseInput({ entry: null }))).toEqual({ kind: "invalid" });
  });

  it("returns invalid when the entry's event could not be loaded", () => {
    expect(resolveOfferLandingOutcome(baseInput({ event: null }))).toEqual({ kind: "invalid" });
  });

  it("returns invalid when a legacy entry carries a null quantity", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({ entry: { id: "e", email: "a@b.com", quantity: null } })
    );
    expect(outcome).toEqual({ kind: "invalid" });
  });

  it("returns invalid when a legacy entry carries a zero or negative quantity", () => {
    expect(
      resolveOfferLandingOutcome(
        baseInput({ entry: { id: "e", email: "a@b.com", quantity: 0 } })
      )
    ).toEqual({ kind: "invalid" });
  });

  it("returns closed when the event is unpublished", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({ event: { is_published: false, registration_enabled: true, isMembersOnly: false } })
    );
    expect(outcome).toEqual({ kind: "closed" });
  });

  it("returns closed when registration is disabled", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({ event: { is_published: true, registration_enabled: false, isMembersOnly: false } })
    );
    expect(outcome).toEqual({ kind: "closed" });
  });

  it("redirects a signed-out visitor to sign in on a members-only event", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({
        event: { is_published: true, registration_enabled: true, isMembersOnly: true },
        isLoggedIn: false,
      })
    );
    expect(outcome).toEqual({
      kind: "signin_redirect",
      loginUrl: "/login?next=%2Fpublic%2Foffers%2Ftok",
    });
  });

  it("shows the members-only panel to a signed-in visitor who is not an active member", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({
        event: { is_published: true, registration_enabled: true, isMembersOnly: true },
        isLoggedIn: true,
        isActiveMember: false,
      })
    );
    expect(outcome).toEqual({ kind: "members_only" });
  });

  it("renders checkout for a signed-in active member on a members-only event", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({
        event: { is_published: true, registration_enabled: true, isMembersOnly: true },
        isLoggedIn: true,
        isActiveMember: true,
      })
    );
    expect(outcome).toEqual({ kind: "checkout", redeemableQuantity: 2 });
  });

  it("returns already_registered when the entry is redeemed, ahead of the seats check", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({ redeemedRegistration: { reference_code: "EV-ABC123" }, seatsFree: 0 })
    );
    expect(outcome).toEqual({ kind: "already_registered", referenceCode: "EV-ABC123" });
  });

  it("returns seats_gone when zero seats are free", () => {
    const outcome = resolveOfferLandingOutcome(baseInput({ seatsFree: 0 }));
    expect(outcome).toEqual({ kind: "seats_gone" });
  });

  it("returns seats_gone rather than a negative redeemable quantity on an over-cap event", () => {
    const outcome = resolveOfferLandingOutcome(baseInput({ seatsFree: -3 }));
    expect(outcome).toEqual({ kind: "seats_gone" });
  });

  it("checks membership before redemption/seats — order matches the flowchart", () => {
    const outcome = resolveOfferLandingOutcome(
      baseInput({
        event: { is_published: true, registration_enabled: true, isMembersOnly: true },
        isLoggedIn: false,
        redeemedRegistration: { reference_code: "EV-XYZ" },
        seatsFree: 0,
      })
    );
    expect(outcome).toEqual({
      kind: "signin_redirect",
      loginUrl: "/login?next=%2Fpublic%2Foffers%2Ftok",
    });
  });
});
