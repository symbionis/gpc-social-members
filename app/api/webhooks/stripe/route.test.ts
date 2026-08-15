import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/events/roster", () => ({
  mintRegistrationTickets: vi.fn().mockResolvedValue(undefined),
  applyPendingRoster: vi.fn().mockResolvedValue(undefined),
  applyTopupRoster: vi.fn().mockResolvedValue("applied"),
  markLeadTickets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/utils/card", () => ({ generateCardNumber: vi.fn(() => "CARD1") }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import {
  mintRegistrationTickets,
  applyPendingRoster,
  applyTopupRoster,
  markLeadTickets,
} from "@/lib/events/roster";
import type { TopupRosterStatus } from "@/lib/events/roster";

const mockedStripe = vi.mocked(getStripe);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedEmail = vi.mocked(sendEventRegistrationConfirmation);
const mockedMint = vi.mocked(mintRegistrationTickets);
const mockedApply = vi.mocked(applyPendingRoster);
const mockedApplyTopup = vi.mocked(applyTopupRoster);
const mockedMarkLead = vi.mocked(markLeadTickets);

// ===========================================================================
// Nominative roster branch (U5): presence-gated fill + checkout.session.expired
// ===========================================================================

type RegRow = { id: string; status: string; pending_roster: unknown; name?: string; email?: string } | null;

let regRow: RegRow;
let updates: Record<string, unknown>[];

function rosterAdmin() {
  return {
    from: (table: string) => {
      if (table !== "event_registrations" && table !== "event_registration_topups") {
        throw new Error(`unexpected table ${table}`);
      }
      const c: Record<string, unknown> = {};
      c.select = () => ({
        eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: regRow, error: null }) }) }),
      });
      c.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) => resolve({ error: null });
        return chain;
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function fireCompleted() {
  const event = {
    type: "checkout.session.completed",
    id: "evt_1",
    data: { object: { id: "cs_1", payment_intent: "pi_1", metadata: { event_registration_id: "reg-1" } } },
  };
  mockedStripe.mockReturnValue({ webhooks: { constructEvent: () => event } } as unknown as ReturnType<typeof getStripe>);
  const req = new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig" },
  });
  return POST(req as never);
}

function fireExpired(metadata: Record<string, string> = { event_registration_id: "reg-1" }) {
  const event = { type: "checkout.session.expired", id: "evt_2", data: { object: { id: "cs_1", metadata } } };
  mockedStripe.mockReturnValue({ webhooks: { constructEvent: () => event } } as unknown as ReturnType<typeof getStripe>);
  const req = new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig" },
  });
  return POST(req as never);
}

const roster = [{ ticket_type_id: "t1", name: "Ana", email: "ana@x.ch" }];

describe("event registration checkout.session.completed (U5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates = [];
    mockedAdmin.mockReturnValue(rosterAdmin());
  });

  it("first promotion with a roster: promotes, mints, applies roster, flips is_lead, emails", async () => {
    regRow = { id: "reg-1", status: "pending", pending_roster: roster, name: "Buyer Person", email: "buyer@x.ch" };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates.some((u) => u.status === "paid")).toBe(true);
    expect(mockedMint).toHaveBeenCalledWith("reg-1");
    expect(mockedApply).toHaveBeenCalledWith("reg-1");
    // KTD3/KTD9: nothing seeds the buyer separately any more — mint issues their
    // seat unclaimed like every guest's, applyPendingRoster claims it (their entry
    // is in the staged roster, U2), and this is what flips is_lead afterward.
    expect(mockedMarkLead).toHaveBeenCalledWith("reg-1", "Buyer Person", "buyer@x.ch");
    expect(mockedEmail).toHaveBeenCalledWith("reg-1");
  });

  it("recovery redelivery (already paid, roster still present): applies roster, no re-promote, no email", async () => {
    regRow = { id: "reg-1", status: "paid", pending_roster: roster, name: "Buyer Person", email: "buyer@x.ch" };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates.some((u) => u.status === "paid")).toBe(false); // not re-promoted
    expect(mockedApply).toHaveBeenCalledWith("reg-1");
    expect(mockedMarkLead).toHaveBeenCalledWith("reg-1", "Buyer Person", "buyer@x.ch");
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  it("finished registration (paid, roster cleared): short-circuits, no side effects", async () => {
    regRow = { id: "reg-1", status: "paid", pending_roster: null, name: "Buyer Person", email: "buyer@x.ch" };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true, already_processed: true });
    expect(mockedMint).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedMarkLead).not.toHaveBeenCalled();
  });

  it("first promotion with no roster: mints, no roster apply, still flips is_lead", async () => {
    regRow = { id: "reg-1", status: "pending", pending_roster: null, name: "Buyer Person", email: "buyer@x.ch" };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(mockedMint).toHaveBeenCalledWith("reg-1");
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedMarkLead).toHaveBeenCalledWith("reg-1", "Buyer Person", "buyer@x.ch");
    expect(mockedEmail).toHaveBeenCalledWith("reg-1");
  });
});

describe("checkout.session.expired cleanup (KTD7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates = [];
    mockedAdmin.mockReturnValue(rosterAdmin());
  });

  it("clears pending_roster for the registration, no roster side effects", async () => {
    regRow = { id: "reg-1", status: "pending", pending_roster: roster };
    const res = await fireExpired();
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates.some((u) => "pending_roster" in u && u.pending_roster === null)).toBe(true);
    expect(mockedApply).not.toHaveBeenCalled();
    expect(mockedMarkLead).not.toHaveBeenCalled();
  });

  it("no-ops when the expired session carries no registration id", async () => {
    regRow = null;
    const res = await fireExpired({});
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates).toHaveLength(0);
  });
});

// ===========================================================================
// Ticket-type conversion branch (#58)
// ===========================================================================

const REG = "reg-1";
const CONV = "conv-1";

let currentEvent: unknown;
const constructEvent = vi.fn(() => currentEvent);
const piUpdate = vi.fn().mockResolvedValue({});

// rpc(name, args) resolves to whatever the test sets for apply_ticket_type_conversion.
let rpcResult: { data: unknown; error: unknown } = { data: { status: "applied" }, error: null };
const rpc = vi.fn(async () => rpcResult);

// A thenable chain for from(...) — only exercised by the fall-through (non-conversion)
// registration lookup, which resolves via maybeSingle.
function convAdmin(existingReg: Record<string, unknown> | null) {
  return {
    rpc,
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.update = () => c;
      c.insert = () => c;
      c.maybeSingle = async () => ({ data: existingReg, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function makeEvent(metadata: Record<string, string>) {
  return {
    type: "checkout.session.completed",
    id: "evt_test",
    data: { object: { id: "cs_1", metadata, payment_intent: "pi_1" } },
  };
}

function post() {
  const req = new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig_test" },
  });
  return POST(req as never);
}

describe("stripe webhook — ticket-type conversion branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    rpcResult = { data: { status: "applied" }, error: null };
    mockedAdmin.mockReturnValue(convAdmin({ id: REG, status: "paid" }));
    mockedStripe.mockReturnValue({
      webhooks: { constructEvent },
      paymentIntents: { update: piUpdate, retrieve: vi.fn() },
    } as never);
  });

  it("applies a conversion and sends one updated confirmation", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, conversion: "applied" });
    expect(rpc).toHaveBeenCalledWith("apply_ticket_type_conversion", { p_conversion_id: CONV });
    expect(mockedEmail).toHaveBeenCalledTimes(1);
    expect(piUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent on replay: 'already' sends no email", async () => {
    rpcResult = { data: { status: "already" }, error: null };
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, conversion: "already" });
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  it("tags the PaymentIntent needs_refund=conversion_conflict on conflict", async () => {
    rpcResult = { data: { status: "conflict" }, error: null };
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(piUpdate).toHaveBeenCalledWith(
      "pi_1",
      expect.objectContaining({ metadata: expect.objectContaining({ needs_refund: "conversion_conflict" }) })
    );
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  it("tags needs_refund=conversion_not_found on an unknown conversion id", async () => {
    rpcResult = { data: { status: "not_found" }, error: null };
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(piUpdate).toHaveBeenCalledWith(
      "pi_1",
      expect.objectContaining({ metadata: expect.objectContaining({ needs_refund: "conversion_not_found" }) })
    );
  });

  it("returns 500 (Stripe retries) on a transient RPC error", async () => {
    rpcResult = { data: null, error: { message: "deadlock" } };
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(500);
    expect(piUpdate).not.toHaveBeenCalled();
  });

  it("does not touch the conversion path when conversion_id is absent (no regression)", async () => {
    currentEvent = makeEvent({ event_registration_id: REG });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, already_processed: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Top-up branch: gate on the id, and name seats from the top-up's own roster
// ===========================================================================

const TOPUP = "topup-1";

describe("stripe webhook — top-up branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    rpcResult = { data: { status: "applied" }, error: null };
    mockedApplyTopup.mockResolvedValue("applied");
    mockedAdmin.mockReturnValue(convAdmin({ id: REG, status: "paid" }));
    mockedStripe.mockReturnValue({
      webhooks: { constructEvent },
      paymentIntents: { update: piUpdate, retrieve: vi.fn() },
    } as never);
  });

  // The regression this guards: the gate used to be
  // `metadata.topup === "true" ? metadata.topup_id : undefined`, so a delivery carrying
  // the id but missing the flag fell through to the paid short-circuit and acked a
  // captured payment without minting anything.
  it("runs on topup_id alone, with no `topup` flag in the metadata", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, topup: "applied" });
    expect(rpc).toHaveBeenCalledWith("apply_registration_topup", { p_topup_id: TOPUP });
    expect(mockedMint).toHaveBeenCalledWith(REG);
  });

  it("still runs when the legacy `topup` flag is present alongside the id", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, topup: "true", topup_id: TOPUP });
    const res = await post();
    expect(await res.json()).toMatchObject({ received: true, topup: "applied" });
    expect(rpc).toHaveBeenCalledWith("apply_registration_topup", { p_topup_id: TOPUP });
  });

  // The names belong to the top-up that bought them. Reading the registration's shared
  // slot instead is what let a redelivery of the ORIGINAL checkout consume them.
  it("names the new seats from the top-up's own roster, not the registration's", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    await post();
    expect(mockedApplyTopup).toHaveBeenCalledWith(TOPUP);
    expect(mockedApply).not.toHaveBeenCalled();
  });

  // The transition shim that fell back to the registration slot is retired, so this is now
  // unconditional: a top-up must NEVER reach event_registrations.pending_roster, whatever the
  // apply reports. A second producer on that column is the whole defect 20260811064034 fixed.
  //
  // `error` is covered by its own two cases below (it alone also drives a 500), so it is
  // excluded here rather than folded in with a status-conditional expectation.
  const NON_ERROR_STATUSES = ["applied", "no_roster", "not_found"] as const;

  // Add a member to TopupRosterStatus and this stops compiling until the new status is either
  // listed above or given its own case. Without it the table is a hand-maintained copy of the
  // union and a new status silently goes unexercised against the invariant.
  type UncoveredStatus = Exclude<TopupRosterStatus, "error" | (typeof NON_ERROR_STATUSES)[number]>;
  const _everyStatusCovered: [UncoveredStatus] extends [never] ? true : never = true;
  void _everyStatusCovered;

  it.each(NON_ERROR_STATUSES)(
    "never touches the registration's roster slot (status: %s)",
    async (status) => {
      mockedApplyTopup.mockResolvedValue(status);
      currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
      await post();
      expect(mockedApplyTopup).toHaveBeenCalledWith(TOPUP);
      expect(mockedApply).not.toHaveBeenCalled();
    }
  );

  // `not_found` is documented as unreachable, so the loud log IS the branch — reaching it
  // means apply_registration_topup's 'not_found' exit was bypassed and that invariant broke.
  // Without this the log can be deleted and nothing fails. It must also stay a 200: a retry
  // cannot conjure a vanished row, so 500-ing here would retry forever.
  it("logs loudly but still acks when the top-up row vanished before the roster apply", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedApplyTopup.mockResolvedValue("not_found");
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    const res = await post();
    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("top-up row vanished"),
      expect.objectContaining({ topupId: TOPUP, eventRegistrationId: REG })
    );
    errorSpy.mockRestore();
  });

  // Seats must exist before they can be named. Swap these two and every claim no-ops
  // against a set of tickets that has not been minted yet, while the RPC clears the
  // roster regardless — a permanently unnamed, paid seat with nothing logged.
  it("mints the new seats before naming them", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    await post();
    expect(mockedMint.mock.invocationCallOrder[0]).toBeLessThan(
      mockedApplyTopup.mock.invocationCallOrder[0]
    );
  });

  // The whole point of the status return. A 200 here would stop Stripe retrying and strand
  // the names on a column nothing else reads — the exact defect this branch exists to fix.
  it("returns 500 so Stripe retries when the roster apply fails", async () => {
    mockedApplyTopup.mockResolvedValue("error");
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    const res = await post();
    expect(res.status).toBe(500);
    // ...but only after the confirmation email, which the retry would skip:
    // apply_registration_topup returns 'already' on replay. U4: the receipt sender is told
    // which payment it's receipting (the paying-row identifier).
    expect(mockedEmail).toHaveBeenCalledWith(REG, { payingRow: { type: "topup", id: TOPUP } });
  });

  it("does not fall back to the registration slot on an apply failure", async () => {
    mockedApplyTopup.mockResolvedValue("error");
    currentEvent = makeEvent({ event_registration_id: REG, topup_id: TOPUP });
    await post();
    expect(mockedApply).not.toHaveBeenCalled();
  });
});

describe("checkout.session.expired — top-up guest PII sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    updates = [];
    mockedAdmin.mockReturnValue(rosterAdmin());
    mockedStripe.mockReturnValue({
      webhooks: { constructEvent },
      paymentIntents: { update: piUpdate, retrieve: vi.fn() },
    } as never);
  });

  // An abandoned top-up stages names and emails on the top-up row, which the registration
  // sweep cannot reach — and once abandoned, nothing ever reads that column again.
  it("clears the abandoned top-up's staged names", async () => {
    regRow = { id: REG, status: "pending", pending_roster: null };
    currentEvent = {
      type: "checkout.session.expired",
      id: "evt_exp",
      data: { object: { id: "cs_1", metadata: { topup_id: TOPUP } } },
    };
    await post();
    expect(updates.some((u) => "pending_roster" in u && u.pending_roster === null)).toBe(true);
  });
});
