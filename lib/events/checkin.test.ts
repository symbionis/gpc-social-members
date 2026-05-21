import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  normalizeEmail,
  resolveMatch,
  isUniqueViolation,
  matchEmail,
  recordCheckin,
  findExistingCheckin,
} from "@/lib/events/checkin";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedCreateAdminClient = vi.mocked(createAdminClient);

type QResult = { data: unknown; error: unknown };

// Thenable query builder: matchEmail awaits the chain directly (no .single()).
function matchClient(
  regs: unknown[],
  members: unknown[],
  opts: { regsError?: unknown; membersError?: unknown } = {}
) {
  return {
    from: (table: string) => {
      const result: QResult =
        table === "members"
          ? { data: members, error: opts.membersError ?? null }
          : { data: regs, error: opts.regsError ?? null };
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "ilike", "order"]) c[m] = () => c;
      (c as { then: unknown }).then = (resolve: (r: QResult) => unknown) =>
        resolve(result);
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

// insert→select→single resolves insertResult; a bare select→eq→single (the
// 23505 re-fetch, or findExistingCheckin) resolves refetchResult.
function recordClient(opts: { insertResult: QResult; refetchResult?: QResult }) {
  return {
    from: () => {
      let isInsert = false;
      const c: Record<string, unknown> = {
        insert: () => {
          isInsert = true;
          return c;
        },
        select: () => c,
        eq: () => c,
        single: async () =>
          isInsert ? opts.insertResult : opts.refetchResult ?? { data: null, error: null },
        maybeSingle: async () => opts.refetchResult ?? { data: null, error: null },
      };
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => vi.clearAllMocks());

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jean@X.CH ")).toBe("jean@x.ch");
  });
});

describe("resolveMatch", () => {
  const reg = { id: "reg-1", email: "alice@example.com" };
  const member = { id: "mem-1", email: "bob@example.com" };

  it("matches a registration -> registered (AE1)", () => {
    expect(resolveMatch("alice@example.com", [reg], [])).toEqual({
      kind: "registered",
      registrationId: "reg-1",
    });
  });

  it("matches an active member with no registration -> member (AE3)", () => {
    expect(resolveMatch("bob@example.com", [], [member])).toEqual({
      kind: "member",
      memberId: "mem-1",
    });
  });

  it("matches neither -> guest", () => {
    expect(resolveMatch("nobody@example.com", [reg], [member])).toEqual({
      kind: "guest",
    });
  });

  it("matches case-insensitively on both legs (eq-vs-ilike regression guard)", () => {
    const mixedReg = { id: "reg-2", email: "Jean@X.ch" };
    const mixedMember = { id: "mem-2", email: "MARIE@x.CH" };
    expect(resolveMatch("  JEAN@x.ch ", [mixedReg], [])).toEqual({
      kind: "registered",
      registrationId: "reg-2",
    });
    expect(resolveMatch("marie@x.ch", [], [mixedMember])).toEqual({
      kind: "member",
      memberId: "mem-2",
    });
  });

  it("registration wins when an email matches both (precedence)", () => {
    const both = "dual@example.com";
    expect(
      resolveMatch(both, [{ id: "reg-3", email: both }], [{ id: "mem-3", email: both }])
    ).toEqual({ kind: "registered", registrationId: "reg-3" });
  });

  it("tolerates null emails in candidate rows", () => {
    expect(
      resolveMatch("x@y.z", [{ id: "r", email: null }], [{ id: "m", email: null }])
    ).toEqual({ kind: "guest" });
  });
});

describe("isUniqueViolation", () => {
  it("treats 23505 as a unique violation (already checked in -> AE4)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other / missing codes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});

describe("matchEmail", () => {
  it("resolves a registration via the registrations leg", async () => {
    mockedCreateAdminClient.mockReturnValue(
      matchClient([{ id: "reg-1", email: "a@b.com" }], [])
    );
    expect(await matchEmail("evt", "a@b.com")).toEqual({
      kind: "registered",
      registrationId: "reg-1",
    });
  });

  it("resolves a member when no registration matches", async () => {
    mockedCreateAdminClient.mockReturnValue(
      matchClient([], [{ id: "mem-1", email: "a@b.com" }])
    );
    expect(await matchEmail("evt", "a@b.com")).toEqual({
      kind: "member",
      memberId: "mem-1",
    });
  });

  it("throws on a registrations query error (fail-closed, not silent guest)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      matchClient([], [], { regsError: { message: "db down" } })
    );
    await expect(matchEmail("evt", "a@b.com")).rejects.toBeTruthy();
  });

  it("throws on a members query error", async () => {
    mockedCreateAdminClient.mockReturnValue(
      matchClient([], [], { membersError: { message: "db down" } })
    );
    await expect(matchEmail("evt", "a@b.com")).rejects.toBeTruthy();
  });
});

describe("recordCheckin", () => {
  const base = {
    eventId: "evt",
    name: "Jean",
    email: "jean@example.com",
    language: "en" as const,
    match: { kind: "guest" as const },
    inviterName: "Marie",
    marketingConsent: true,
  };

  it("returns already:false with the inserted acceptance time on success", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({ insertResult: { data: { waiver_accepted_at: "2026-05-22T10:00:00Z" }, error: null } })
    );
    expect(await recordCheckin(base)).toEqual({
      already: false,
      checkedInAt: "2026-05-22T10:00:00Z",
    });
  });

  it("treats 23505 as already:true and returns the original time (AE4)", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        insertResult: { data: null, error: { code: "23505" } },
        refetchResult: { data: { waiver_accepted_at: "2026-05-22T09:30:00Z" }, error: null },
      })
    );
    expect(await recordCheckin(base)).toEqual({
      already: true,
      checkedInAt: "2026-05-22T09:30:00Z",
    });
  });

  it("throws on a non-unique insert error rather than reporting success", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({ insertResult: { data: null, error: { code: "23503" } } })
    );
    await expect(recordCheckin(base)).rejects.toBeTruthy();
  });
});

describe("findExistingCheckin", () => {
  it("returns the acceptance time when a row exists", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({
        insertResult: { data: null, error: null },
        refetchResult: { data: { waiver_accepted_at: "2026-05-22T08:00:00Z" }, error: null },
      })
    );
    expect(await findExistingCheckin("evt", "a@b.com")).toEqual({
      checkedInAt: "2026-05-22T08:00:00Z",
    });
  });

  it("returns null when no row exists", async () => {
    mockedCreateAdminClient.mockReturnValue(
      recordClient({ insertResult: { data: null, error: null }, refetchResult: { data: null, error: null } })
    );
    expect(await findExistingCheckin("evt", "a@b.com")).toBeNull();
  });
});
