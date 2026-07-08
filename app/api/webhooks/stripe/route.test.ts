import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/events/roster", () => ({
  seedLeadAttendee: vi.fn().mockResolvedValue(undefined),
  mintRegistrationTickets: vi.fn().mockResolvedValue(undefined),
  applyPendingRoster: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/utils/card", () => ({ generateCardNumber: vi.fn(() => "CARD1") }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { seedLeadAttendee, mintRegistrationTickets, applyPendingRoster } from "@/lib/events/roster";

const mockedStripe = vi.mocked(getStripe);
const mockedAdmin = vi.mocked(createAdminClient);
const mockedEmail = vi.mocked(sendEventRegistrationConfirmation);
const mockedSeed = vi.mocked(seedLeadAttendee);
const mockedMint = vi.mocked(mintRegistrationTickets);
const mockedApply = vi.mocked(applyPendingRoster);

// ===========================================================================
// Nominative roster branch (U5): presence-gated fill + checkout.session.expired
// ===========================================================================

type RegRow = { id: string; status: string; pending_roster: unknown } | null;

let regRow: RegRow;
let updates: Record<string, unknown>[];

function rosterAdmin() {
  return {
    from: (table: string) => {
      if (table !== "event_registrations") throw new Error(`unexpected table ${table}`);
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

  it("first promotion with a roster: promotes, seeds, mints, applies roster, emails", async () => {
    regRow = { id: "reg-1", status: "pending", pending_roster: roster };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates.some((u) => u.status === "paid")).toBe(true);
    expect(mockedSeed).toHaveBeenCalledWith("reg-1");
    expect(mockedMint).toHaveBeenCalledWith("reg-1");
    expect(mockedApply).toHaveBeenCalledWith("reg-1");
    expect(mockedEmail).toHaveBeenCalledWith("reg-1");
  });

  it("recovery redelivery (already paid, roster still present): applies roster, no re-promote, no email", async () => {
    regRow = { id: "reg-1", status: "paid", pending_roster: roster };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(updates.some((u) => u.status === "paid")).toBe(false); // not re-promoted
    expect(mockedApply).toHaveBeenCalledWith("reg-1");
    expect(mockedEmail).not.toHaveBeenCalled();
  });

  it("finished registration (paid, roster cleared): short-circuits, no side effects", async () => {
    regRow = { id: "reg-1", status: "paid", pending_roster: null };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true, already_processed: true });
    expect(mockedSeed).not.toHaveBeenCalled();
    expect(mockedMint).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it("first promotion with no roster: seeds + mints, no roster apply", async () => {
    regRow = { id: "reg-1", status: "pending", pending_roster: null };
    const res = await fireCompleted();
    expect((await res.json())).toMatchObject({ received: true });
    expect(mockedSeed).toHaveBeenCalledWith("reg-1");
    expect(mockedMint).toHaveBeenCalledWith("reg-1");
    expect(mockedApply).not.toHaveBeenCalled();
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
    expect(mockedSeed).not.toHaveBeenCalled();
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
