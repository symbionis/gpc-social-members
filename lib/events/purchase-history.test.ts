import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolvePurchaseHistory } from "@/lib/events/purchase-history";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

interface Fixture {
  self?: Record<string, unknown> | null; // tickets by manage_token
  selfReg?: Record<string, unknown> | null; // event_registrations by id (self ticket's own reg — for its email)
  regRows?: Record<string, unknown>[]; // event_registrations .in("status", [...]) — the global scan
  eventRows?: Record<string, unknown>[];
  itemsByReg?: Record<string, Record<string, unknown>[]>;
  topupsByReg?: Record<string, Record<string, unknown>[]>;
  refundedTicketsByReg?: Record<string, Record<string, unknown>[]>;
}

// Dispatch by (table, accumulated .eq/.in filters). Mirrors the pattern in
// lib/events/household.test.ts and lib/email/event-registration.test.ts.
function adminClient(f: Fixture) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.is = () => chain;
      chain.order = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.in = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === "tickets" && "manage_token" in filters) return { data: f.self ?? null, error: null };
        if (table === "event_registrations" && "id" in filters) return { data: f.selfReg ?? null, error: null };
        return { data: null, error: null };
      };
      (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_registrations" && "status" in filters) {
          return resolve({ data: f.regRows ?? [], error: null });
        }
        if (table === "events") return resolve({ data: f.eventRows ?? [], error: null });
        if (table === "event_registration_items") {
          const regId = filters.registration_id as string;
          return resolve({ data: (f.itemsByReg ?? {})[regId] ?? [], error: null });
        }
        if (table === "event_registration_topups") {
          const regId = filters.registration_id as string;
          return resolve({ data: (f.topupsByReg ?? {})[regId] ?? [], error: null });
        }
        if (table === "tickets" && "cancellation_status" in filters) {
          const regId = filters.registration_id as string;
          return resolve({ data: (f.refundedTicketsByReg ?? {})[regId] ?? [], error: null });
        }
        return resolve({ data: [], error: null });
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const LEAD_TICKET = { id: "T-lead", registration_id: "R1", is_lead: true };

const REG1 = {
  id: "R1",
  event_id: "E1",
  email: "payer@example.com",
  status: "paid",
  quantity: 2,
  total_amount_chf: 160,
  reference_code: "EV-AAA",
  paid_at: "2026-06-01T10:00:00Z",
  created_at: "2026-05-30T10:00:00Z",
  stripe_payment_intent_id: "pi_original_1",
};

const EVENT1 = { id: "E1", title: "Polo Brunch", start_date: "2026-06-15" };

beforeEach(() => vi.clearAllMocks());

describe("resolvePurchaseHistory — KTD4 access control", () => {
  it("refuses when the token's own ticket does NOT carry is_lead, even though it matches the payer's email by editing the address", async () => {
    // The security-critical case: a non-payer household member edits their OWN ticket's
    // email to equal the payer's address. If the gate were "does this ticket's email match
    // the registration's email", this would pass. It must not — the gate is is_lead alone.
    mockedAdmin.mockReturnValue(
      adminClient({
        self: { id: "T-nonlead", registration_id: "R1", is_lead: false },
        selfReg: { email: "payer@example.com" },
        regRows: [REG1],
        eventRows: [EVENT1],
      })
    );
    const history = await resolvePurchaseHistory("tok-nonlead");
    expect(history).toBeNull();
  });

  it("refuses a non-payer requesting the URL directly (unknown token)", async () => {
    mockedAdmin.mockReturnValue(adminClient({ self: null }));
    const history = await resolvePurchaseHistory("tok-unknown");
    expect(history).toBeNull();
  });

  it("refuses an unknown/rotated manage token", async () => {
    mockedAdmin.mockReturnValue(adminClient({ self: null }));
    expect(await resolvePurchaseHistory("")).toBeNull();
    expect(await resolvePurchaseHistory("rotated-away")).toBeNull();
  });

  it("grants access when the token's ticket DOES carry is_lead", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [REG1],
        eventRows: [EVENT1],
        itemsByReg: {
          R1: [{ ticket_type_id: "tt-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 80, line_total_chf: 160 }],
        },
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    expect(history).not.toBeNull();
    expect(history!.bookings).toHaveLength(1);
  });
});

describe("resolvePurchaseHistory — AE11 cross-event listing, newest first", () => {
  it("lists purchases across three events, newest first", async () => {
    const reg2 = { ...REG1, id: "R2", event_id: "E2", paid_at: "2026-07-01T10:00:00Z", created_at: "2026-06-29T00:00:00Z", reference_code: "EV-BBB" };
    const reg3 = { ...REG1, id: "R3", event_id: "E3", paid_at: "2026-05-01T10:00:00Z", created_at: "2026-04-29T00:00:00Z", reference_code: "EV-CCC" };
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [REG1, reg2, reg3],
        eventRows: [
          EVENT1,
          { id: "E2", title: "Asado Night", start_date: "2026-07-20" },
          { id: "E3", title: "Chukka Cup", start_date: "2026-05-10" },
        ],
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    expect(history!.bookings.map((b) => b.referenceCode)).toEqual(["EV-BBB", "EV-AAA", "EV-CCC"]);
  });

  it("matches the payer's email case-insensitively and trimmed, and excludes other addresses", async () => {
    const otherAddress = { ...REG1, id: "R-other", event_id: "E1", email: "someone-else@example.com", reference_code: "EV-OTHER" };
    const sameButCased = { ...REG1, id: "R-cased", event_id: "E1", email: "  Payer@Example.com  ", reference_code: "EV-CASED", paid_at: "2026-06-02T10:00:00Z" };
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [REG1, otherAddress, sameButCased],
        eventRows: [EVENT1],
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    expect(history!.bookings.map((b) => b.referenceCode).sort()).toEqual(["EV-AAA", "EV-CASED"]);
  });
});

describe("resolvePurchaseHistory — per-payment entries (KTD3)", () => {
  it("renders the original checkout and each applied top-up as its own entry with its own charge reference", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [REG1],
        eventRows: [EVENT1],
        itemsByReg: {
          R1: [
            { ticket_type_id: "tt-std", title_snapshot: "Standard", quantity: 4, unit_amount_chf: 40, line_total_chf: 160 },
          ],
        },
        topupsByReg: {
          R1: [
            {
              id: "topup-1",
              items: [{ ticket_type_id: "tt-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 40, line_total_chf: 80 }],
              applied_at: "2026-06-05T10:00:00Z",
              stripe_payment_intent_id: "pi_topup_1",
              status: "applied",
            },
          ],
        },
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    const payments = history!.bookings[0].payments;
    expect(payments).toHaveLength(2);

    const original = payments.find((p) => p.id === "original")!;
    expect(original.chargeReference).toBe("pi_original_1");
    // 4 total minus the topup's 2 contributed = 2 remaining on the original (KTD3).
    expect(original.lines).toEqual([{ title: "Standard", quantity: 2, unitLabel: "CHF 40.00", lineLabel: "CHF 80.00" }]);

    const topup = payments.find((p) => p.id === "topup-1")!;
    expect(topup.chargeReference).toBe("pi_topup_1");
    expect(topup.lines).toEqual([{ title: "Standard", quantity: 2, unitLabel: "CHF 40.00", lineLabel: "CHF 80.00" }]);
    expect(topup.paidAtIso).toBe("2026-06-05T10:00:00Z");
  });

  it("renders a refunded payment annotated as refunded, not as an outstanding charge", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [REG1],
        eventRows: [EVENT1],
        itemsByReg: {
          R1: [{ ticket_type_id: "tt-std", title_snapshot: "Standard", quantity: 2, unit_amount_chf: 80, line_total_chf: 160 }],
        },
        refundedTicketsByReg: {
          R1: [{ registration_id: "R1", ticket_type_id: "tt-std", is_comp: false, refund_amount_chf: 80 }],
        },
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    const original = history!.bookings[0].payments.find((p) => p.id === "original")!;
    expect(original.refunded).toBe(true);
    expect(original.refundedChf).toBe(80);
  });

  it("renders a booking with no payment (comp/free) without a charge reference, and doesn't break", async () => {
    const freeReg = { ...REG1, status: "free", stripe_payment_intent_id: null, total_amount_chf: 0, quantity: 1 };
    mockedAdmin.mockReturnValue(
      adminClient({
        self: LEAD_TICKET,
        selfReg: { email: "payer@example.com" },
        regRows: [freeReg],
        eventRows: [EVENT1],
        itemsByReg: { R1: [] },
      })
    );
    const history = await resolvePurchaseHistory("tok-lead");
    const original = history!.bookings[0].payments.find((p) => p.id === "original")!;
    expect(original.chargeReference).toBeNull();
    expect(original.refunded).toBe(false);
  });
});
