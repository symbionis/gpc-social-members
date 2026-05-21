import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  generateReferenceCode,
  findActiveMemberByEmail,
  hasExistingRegistration,
} from "@/lib/events/registration";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type QResult = { data: unknown; error: unknown };

// Thenable query builder — the helpers await the chain directly.
function client(result: QResult) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "ilike", "order", "limit"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (r: QResult) => unknown) => resolve(result);
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => vi.clearAllMocks());

describe("generateReferenceCode", () => {
  it("returns EV- plus 8 chars from the reference alphabet", () => {
    expect(generateReferenceCode()).toMatch(
      /^EV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
    );
  });
});

describe("findActiveMemberByEmail", () => {
  it("returns an active member matching case-insensitively", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({ data: [{ id: "m1", email: "Jean@X.ch", created_at: "2026-01-01" }], error: null })
    );
    expect(await findActiveMemberByEmail("  jean@x.ch ")).toEqual({ id: "m1" });
  });

  it("returns the earliest when multiple active members share the email", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({
        data: [
          { id: "m1", email: "dup@x.ch", created_at: "2026-01-01" },
          { id: "m2", email: "dup@x.ch", created_at: "2026-02-01" },
        ],
        error: null,
      })
    );
    expect(await findActiveMemberByEmail("dup@x.ch")).toEqual({ id: "m1" });
  });

  it("returns null when nothing exactly matches (wildcard over-match guard)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({ data: [{ id: "mx", email: "other@x.ch", created_at: "2026-01-01" }], error: null })
    );
    expect(await findActiveMemberByEmail("jean@x.ch")).toBeNull();
  });

  it("throws on a query error (fail-closed)", async () => {
    mockedCreateAdminClient.mockReturnValue(client({ data: null, error: { message: "db down" } }));
    await expect(findActiveMemberByEmail("a@b.c")).rejects.toBeTruthy();
  });
});

describe("hasExistingRegistration", () => {
  it("true when a paid/free row matches the email", async () => {
    mockedCreateAdminClient.mockReturnValue(
      client({ data: [{ id: "r1", email: "a@b.c" }], error: null })
    );
    expect(await hasExistingRegistration("e1", "A@B.c")).toBe(true);
  });

  it("false when no paid/free row matches", async () => {
    mockedCreateAdminClient.mockReturnValue(client({ data: [], error: null }));
    expect(await hasExistingRegistration("e1", "a@b.c")).toBe(false);
  });

  it("throws on a query error", async () => {
    mockedCreateAdminClient.mockReturnValue(client({ data: null, error: { message: "db down" } }));
    await expect(hasExistingRegistration("e1", "a@b.c")).rejects.toBeTruthy();
  });
});
