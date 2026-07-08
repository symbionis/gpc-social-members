import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/events/roster", () => ({
  seedLeadAttendee: vi.fn().mockResolvedValue(undefined),
  mintRegistrationTickets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/utils/card", () => ({ generateCardNumber: vi.fn(() => "CARD1") }));

import { POST } from "@/app/api/webhooks/stripe/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);
const mockedConfirm = vi.mocked(sendEventRegistrationConfirmation);

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
function adminClient(existingReg: Record<string, unknown> | null) {
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  rpcResult = { data: { status: "applied" }, error: null };
  mockedAdmin.mockReturnValue(adminClient({ id: REG, status: "paid" }));
  mockedStripe.mockReturnValue({
    webhooks: { constructEvent },
    paymentIntents: { update: piUpdate, retrieve: vi.fn() },
  } as never);
});

describe("stripe webhook — ticket-type conversion branch", () => {
  it("applies a conversion and sends one updated confirmation", async () => {
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, conversion: "applied" });
    expect(rpc).toHaveBeenCalledWith("apply_ticket_type_conversion", { p_conversion_id: CONV });
    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(piUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent on replay: 'already' sends no email", async () => {
    rpcResult = { data: { status: "already" }, error: null };
    currentEvent = makeEvent({ event_registration_id: REG, conversion_id: CONV });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, conversion: "already" });
    expect(mockedConfirm).not.toHaveBeenCalled();
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
    expect(mockedConfirm).not.toHaveBeenCalled();
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
