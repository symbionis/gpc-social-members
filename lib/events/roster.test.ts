import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { fillRegistrationRoster, applyTopupRoster } from "@/lib/events/roster";
import { createAdminClient } from "@/lib/supabase/admin";

const mockedAdmin = vi.mocked(createAdminClient);

function adminWithRpc(rpc: (name: string, args: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn(rpc) } as unknown as ReturnType<typeof createAdminClient> & {
    rpc: ReturnType<typeof vi.fn>;
  };
}

describe("fillRegistrationRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("calls claim_ticket once per attendee with the registration id and type", async () => {
    const client = adminWithRpc(() => ({ data: { status: "claimed" }, error: null }));
    mockedAdmin.mockReturnValue(client);

    await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-asado", name: "Ana", email: "ana@x.ch" },
      { ticket_type_id: "t-veg", name: "Ben", email: "ben@x.ch" },
    ]);

    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(client.rpc).toHaveBeenNthCalledWith(1, "claim_ticket", expect.objectContaining({
      p_registration_id: "reg-1",
      p_name: "Ana",
      p_email: "ana@x.ch",
      p_ticket_type_id: "t-asado",
    }));
    expect(client.rpc).toHaveBeenNthCalledWith(2, "claim_ticket", expect.objectContaining({
      p_registration_id: "reg-1",
      p_ticket_type_id: "t-veg",
    }));
  });

  it("passes the attendee's email and marketing consent", async () => {
    const client = adminWithRpc(() => ({ data: { status: "claimed" }, error: null }));
    mockedAdmin.mockReturnValue(client);

    // Every ticket now carries an email (mandatory naming).
    await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-kid", name: "Kid Guest", email: "kid@x.ch" },
    ]);

    const [, args] = client.rpc.mock.calls[0];
    expect(args.p_email).toBe("kid@x.ch");
    expect(args.p_marketing_consent).toBe(false);
  });

  it("logs and continues when one row's claim errors, still calling the rest", async () => {
    const client = adminWithRpc((_name, args) =>
      args.p_ticket_type_id === "t-bad"
        ? { data: null, error: { message: "type_full" } }
        : { data: { status: "claimed" }, error: null },
    );
    mockedAdmin.mockReturnValue(client);

    const result = await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-bad", name: "Drops", email: "d@x.ch" },
      { ticket_type_id: "t-ok", name: "Fine", email: "f@x.ch" },
    ]);

    expect(client.rpc).toHaveBeenCalledTimes(2);
    // Two lines now: the per-row failure, and the summary naming who was left unseated.
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(result.filled).toBe(1);
    expect(result.unnamed).toEqual([
      { attendee: { ticket_type_id: "t-bad", name: "Drops", email: "d@x.ch" }, reason: "rpc_error" },
    ]);
  });

  // The failure that cost four bookings their guest: claim_ticket's replay guard matched an
  // already-named seat, so it claimed nothing and returned success. The old code read only
  // `error`, saw null, and moved on — the guest's seat stayed issued and unnamed, its QR
  // undelivered, and nothing was logged. A non-error is not a fill.
  it("treats `already: true` as a seat left UNNAMED, not as success", async () => {
    const client = adminWithRpc(() => ({
      data: { status: "claimed", already: true, attendee_id: "someone-else" },
      error: null,
    }));
    mockedAdmin.mockReturnValue(client);

    const result = await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-fri", name: "Leyla Baghirzade", email: "leyla@x.ch" },
    ]);

    expect(result.filled).toBe(0);
    expect(result.unnamed).toEqual([
      {
        attendee: { ticket_type_id: "t-fri", name: "Leyla Baghirzade", email: "leyla@x.ch" },
        reason: "collapsed_onto_existing_seat",
      },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      "[roster] SEATS LEFT UNNAMED after checkout fill",
      expect.objectContaining({ registrationId: "reg-1", filled: 0 }),
    );
  });

  // Same blind spot, different shape: claim_ticket reports a refusal by status, never by error.
  it("treats a refusal status (full / type_full) as a seat left UNNAMED", async () => {
    const client = adminWithRpc(() => ({ data: { status: "type_full" }, error: null }));
    mockedAdmin.mockReturnValue(client);

    const result = await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-sat", name: "Ana Vidal", email: "ana@x.ch" },
    ]);

    expect(result.filled).toBe(0);
    expect(result.unnamed[0].reason).toBe("type_full");
  });

  it("reports a clean fill with nothing logged", async () => {
    const client = adminWithRpc(() => ({
      data: { status: "claimed", already: false },
      error: null,
    }));
    mockedAdmin.mockReturnValue(client);

    const result = await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-fri", name: "Ana Vidal", email: "ana@x.ch" },
      { ticket_type_id: "t-sat", name: "Ana Vidal", email: "ana@x.ch" },
    ]);

    expect(result).toEqual({ filled: 2, unnamed: [] });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("makes no RPC calls for an empty attendee list", async () => {
    const client = adminWithRpc(() => ({ data: null, error: null }));
    mockedAdmin.mockReturnValue(client);

    await fillRegistrationRoster("reg-1", []);

    expect(client.rpc).not.toHaveBeenCalled();
    // Also proves the admin client isn't even constructed for the empty case.
    expect(mockedAdmin).not.toHaveBeenCalled();
  });

  it("issues the same calls when re-invoked (safely repeatable at the helper level)", async () => {
    const client = adminWithRpc(() => ({ data: { status: "claimed" }, error: null }));
    mockedAdmin.mockReturnValue(client);
    const attendees = [{ ticket_type_id: "t1", name: "Ana", email: "ana@x.ch" }];

    await fillRegistrationRoster("reg-1", attendees);
    await fillRegistrationRoster("reg-1", attendees);

    expect(client.rpc).toHaveBeenCalledTimes(2);
  });
});

describe("applyTopupRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes the top-up id to the RPC and returns its status", async () => {
    const client = adminWithRpc(() => ({ data: { status: "applied" }, error: null }));
    mockedAdmin.mockReturnValue(client);

    await expect(applyTopupRoster("topup-1")).resolves.toBe("applied");
    expect(client.rpc).toHaveBeenCalledWith("apply_topup_roster", { p_topup_id: "topup-1" });
  });

  it("reports an already-applied redelivery as no_roster", async () => {
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: { status: "no_roster" }, error: null }))
    );
    await expect(applyTopupRoster("topup-1")).resolves.toBe("no_roster");
  });

  // The RPC still reports `legacy` for a top-up that predates per-top-up rosters. The shim
  // that consumed it is retired, so the flag must no longer change the answer — if it did,
  // a redelivery would re-run the registration-level apply the ownership fix removed.
  it("ignores the RPC's legacy flag now that the fallback is gone", async () => {
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: { status: "no_roster", legacy: true }, error: null }))
    );
    await expect(applyTopupRoster("topup-1")).resolves.toBe("no_roster");
  });

  it("surfaces not_found", async () => {
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: { status: "not_found" }, error: null }))
    );
    await expect(applyTopupRoster("topup-1")).resolves.toBe("not_found");
  });

  // The retry signal. Collapsing this into a success would strand the staged names, since
  // nothing else in the system ever reads that column.
  it("reports an RPC failure as error rather than a domain outcome", async () => {
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: null, error: { message: "deadlock" } }))
    );
    await expect(applyTopupRoster("topup-1")).resolves.toBe("error");
  });

  // Guards against SQL drift: if someone adds a status to the RPC and forgets this file,
  // the unknown value must be loud and retryable, never silently treated as success.
  it("treats an unrecognised status as an error", async () => {
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: { status: "partial" }, error: null }))
    );
    await expect(applyTopupRoster("topup-1")).resolves.toBe("error");
  });

  it("treats a null payload as an error", async () => {
    mockedAdmin.mockReturnValue(adminWithRpc(() => ({ data: null, error: null })));
    await expect(applyTopupRoster("topup-1")).resolves.toBe("error");
  });

  // The RPC clears the roster whether or not every guest was placed, so this log is the only
  // surviving trace that someone paid for a seat nothing named.
  it("logs the guests the apply could not name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({
        data: {
          status: "applied",
          unclaimed: [{ name: "Ana Vidal", email: "ana@x.ch", result: { already: true } }],
        },
        error: null,
      }))
    );

    await expect(applyTopupRoster("topup-1")).resolves.toBe("applied");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("UNNAMED"),
      expect.objectContaining({
        topupId: "topup-1",
        unclaimed: expect.arrayContaining([expect.objectContaining({ name: "Ana Vidal" })]),
      })
    );
  });

  it("stays quiet when every guest was named", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedAdmin.mockReturnValue(
      adminWithRpc(() => ({ data: { status: "applied", unclaimed: [] }, error: null }))
    );

    await expect(applyTopupRoster("topup-1")).resolves.toBe("applied");
    expect(spy).not.toHaveBeenCalled();
  });
});
