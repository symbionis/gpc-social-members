import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/email/event-registration", () => ({
  sendEventRegistrationConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/events/roster", () => ({
  seedLeadAttendee: vi.fn().mockResolvedValue(undefined),
  mintRegistrationTickets: vi.fn().mockResolvedValue(undefined),
  applyPendingRoster: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/utils/card", () => ({ generateCardNumber: vi.fn(() => "CARD") }));

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

type RegRow = { id: string; status: string; pending_roster: unknown } | null;

let regRow: RegRow;
let updates: Record<string, unknown>[];

function adminClient() {
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

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  mockedAdmin.mockReturnValue(adminClient());
});

describe("event registration checkout.session.completed (U5)", () => {
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
