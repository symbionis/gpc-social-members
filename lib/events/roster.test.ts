import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { fillRegistrationRoster } from "@/lib/events/roster";
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

  it("passes the attendee's email and never sends a p_is_child key", async () => {
    const client = adminWithRpc(() => ({ data: { status: "claimed" }, error: null }));
    mockedAdmin.mockReturnValue(client);

    // Every ticket now carries an email (mandatory naming, no former-child exemption).
    await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-kid", name: "Kid Guest", email: "kid@x.ch" },
    ]);

    const [, args] = client.rpc.mock.calls[0];
    expect(args.p_email).toBe("kid@x.ch");
    expect(args).not.toHaveProperty("p_is_child");
    expect(args.p_marketing_consent).toBe(false);
  });

  it("logs and continues when one row's claim errors, still calling the rest", async () => {
    const client = adminWithRpc((_name, args) =>
      args.p_ticket_type_id === "t-bad"
        ? { data: null, error: { message: "type_full" } }
        : { data: { status: "claimed" }, error: null },
    );
    mockedAdmin.mockReturnValue(client);

    await fillRegistrationRoster("reg-1", [
      { ticket_type_id: "t-bad", name: "Drops", email: "d@x.ch" },
      { ticket_type_id: "t-ok", name: "Fine", email: "f@x.ch" },
    ]);

    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
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
