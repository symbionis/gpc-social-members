import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { resolveHousehold } from "@/lib/events/household";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

interface Fixture {
  self?: Record<string, unknown> | null; // tickets by manage_token
  event?: Record<string, unknown> | null;
  reg?: Record<string, unknown> | null;
  siblings?: Record<string, unknown>[]; // tickets by registration_id (the household query)
  solo?: Record<string, unknown> | null; // tickets by id (standalone path)
  types?: Record<string, unknown>[];
}

// Dispatch by (table, accumulated .eq filters, terminal). The tickets table is queried
// three possible ways: self lookup (manage_token → maybeSingle), household siblings
// (registration_id → thenable), and the standalone solo lookup (id → maybeSingle).
function adminClient(f: Fixture) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.is = () => chain;
      chain.in = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === "tickets" && "manage_token" in filters) return { data: f.self ?? null, error: null };
        if (table === "tickets" && "id" in filters) return { data: f.solo ?? null, error: null };
        if (table === "events") return { data: f.event ?? null, error: null };
        if (table === "event_registrations") return { data: f.reg ?? null, error: null };
        return { data: null, error: null };
      };
      // Thenable: the household siblings query and the type-titles query are awaited directly.
      (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "tickets") return resolve({ data: f.siblings ?? [], error: null });
        if (table === "event_ticket_types") return resolve({ data: f.types ?? [], error: null });
        return resolve({ data: [], error: null });
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

const EVENT = {
  id: "E1",
  title: "Pilates & Polo",
  start_date: "2026-07-26",
  start_time: "18:00",
  end_date: null,
  location: "Grounds",
  description: null,
  is_published: true,
};
const TYPES = [{ id: "TT1", title: "Standard" }];

beforeEach(() => vi.clearAllMocks());

describe("resolveHousehold", () => {
  it("resolves the self ticket + same-email siblings (case-insensitive), non-siblings absent", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: { id: "T1", event_id: "E1", registration_id: "R1", email: "House@x.com" },
        event: EVENT,
        reg: { id: "R1", status: "paid", reference_code: "ABC" },
        siblings: [
          { id: "T1", name: "Alice", email: "house@x.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "c1", checked_in_at: null, created_at: "2026-01-01T00:00:00Z" },
          { id: "T2", name: "Bob", email: "HOUSE@x.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "c2", checked_in_at: null, created_at: "2026-01-01T00:00:01Z" },
          { id: "T3", name: "Cara", email: "other@x.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "c3", checked_in_at: null, created_at: "2026-01-01T00:00:02Z" },
        ],
        types: TYPES,
      })
    );
    const hh = await resolveHousehold("tok");
    expect(hh).not.toBeNull();
    expect(hh!.tickets.map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(hh!.tickets.find((t) => t.id === "T1")!.isSelf).toBe(true);
    expect(hh!.tickets.find((t) => t.id === "T2")!.isSelf).toBe(false);
    expect(hh!.tickets[0].credentialUrl).toContain("/c/c1");
    expect(hh!.referenceCode).toBe("ABC");
    expect(hh!.event.title).toBe("Pilates & Polo");
  });

  it("returns a single-ticket household when no siblings share the email", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: { id: "T1", event_id: "E1", registration_id: "R1", email: "solo@x.com" },
        event: EVENT,
        reg: { id: "R1", status: "free", reference_code: "SOLO" },
        siblings: [
          { id: "T1", name: "Alice", email: "solo@x.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "c1", checked_in_at: null, created_at: "2026-01-01T00:00:00Z" },
          { id: "T2", name: "Bob", email: "someone@else.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "c2", checked_in_at: null, created_at: "2026-01-01T00:00:01Z" },
        ],
        types: TYPES,
      })
    );
    const hh = await resolveHousehold("tok");
    expect(hh!.tickets.map((t) => t.id)).toEqual(["T1"]);
  });

  it("returns null for an unknown/rotated token", async () => {
    mockedAdmin.mockReturnValue(adminClient({ self: null }));
    expect(await resolveHousehold("gone")).toBeNull();
  });

  it("returns null when the token is empty", async () => {
    expect(await resolveHousehold("")).toBeNull();
  });

  it("resolves a standalone ticket (no registration) as its own solo household", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        self: { id: "S1", event_id: "E1", registration_id: null, email: "walkup@x.com" },
        event: EVENT,
        solo: { id: "S1", name: "Walk Up", email: "walkup@x.com", ticket_type_id: "TT1", slot_status: "claimed", credential_token: "cs", checked_in_at: null, created_at: "2026-01-01T00:00:00Z" },
        types: TYPES,
      })
    );
    const hh = await resolveHousehold("tok");
    expect(hh!.tickets.map((t) => t.id)).toEqual(["S1"]);
    expect(hh!.tickets[0].isSelf).toBe(true);
    expect(hh!.referenceCode).toBeNull();
    expect(hh!.status).toBe("free");
  });
});
