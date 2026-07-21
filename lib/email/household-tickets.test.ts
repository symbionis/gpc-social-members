import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));

import { sendHouseholdTicketEmails } from "@/lib/email/household-tickets";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedSend = vi.mocked(sendEmail);

interface Guest {
  id: string;
  name: string | null;
  email: string | null;
  credential_token: string | null;
  manage_token: string | null;
  qr_email_sent_at: string | null;
  created_at: string;
}

const REG = { id: "reg-1", event_id: "evt-1", name: "Booker Ben", reference_code: "ABC123" };
const EVENT = { title: "Polo Party", start_date: "2026-07-26", start_time: "18:00:00", location: "Grounds" };

// Captures the ticket-id arrays passed to the stamp update, so tests can assert idempotency.
const stamped: string[][] = [];

function adminClient(opts: {
  reg?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
  guests?: Guest[];
  stampError?: unknown;
}) {
  return {
    from(table: string) {
      let isUpdate = false;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.limit = () => chain;
      chain.update = () => {
        isUpdate = true;
        return chain;
      };
      chain.in = (_col: string, ids: string[]) => {
        stamped.push(ids);
        return chain;
      };
      chain.maybeSingle = async () => {
        if (table === "event_registrations") return { data: opts.reg ?? REG, error: null };
        if (table === "events") return { data: opts.event ?? EVENT, error: null };
        return { data: null, error: null };
      };
      (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "tickets" && isUpdate) return resolve({ error: opts.stampError ?? null });
        if (table === "tickets") return resolve({ data: opts.guests ?? [], error: null });
        return resolve({ data: [], error: null });
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

function guest(over: Partial<Guest>): Guest {
  return {
    id: "t1",
    name: "Alice",
    email: "house@x.com",
    credential_token: "cred1",
    manage_token: "mtok1",
    qr_email_sent_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stamped.length = 0;
  mockedSend.mockResolvedValue({ success: true } as never);
});

describe("sendHouseholdTicketEmails", () => {
  it("covers AE1: three guests on one address → ONE email, three QR blocks, one manage link", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        guests: [
          guest({ id: "t1", name: "Alice", email: "House@x.com", credential_token: "c1", manage_token: "m1", created_at: "2026-01-01T00:00:00Z" }),
          guest({ id: "t2", name: "Bob", email: "house@x.com", credential_token: "c2", manage_token: "m2", created_at: "2026-01-01T00:00:01Z" }),
          guest({ id: "t3", name: "Cara", email: "HOUSE@x.com", credential_token: "c3", manage_token: "m3", created_at: "2026-01-01T00:00:02Z" }),
        ],
      })
    );
    const res = await sendHouseholdTicketEmails("reg-1");
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const call = mockedSend.mock.calls[0][0];
    const model = call.templateModel as {
      tickets: { qr_url: string; name: string | null }[];
      manage_url: string;
      multiple: boolean | null;
    };
    expect(call.to).toBe("House@x.com");
    expect(call.templateAlias).toBe("event-household-tickets");
    expect(model.tickets).toHaveLength(3);
    expect(model.tickets.map((t) => t.qr_url)).toEqual([
      "http://localhost:3000/api/qr/c1",
      "http://localhost:3000/api/qr/c2",
      "http://localhost:3000/api/qr/c3",
    ]);
    expect(model.manage_url).toBe("http://localhost:3000/public/tickets/m1");
    expect(model.multiple).toBe(true);
    // All three stamped together.
    expect(stamped).toEqual([["t1", "t2", "t3"]]);
    expect(res).toEqual({ groups: 1, sent: 1 });
  });

  it("two addresses → two emails, one per group", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        guests: [
          guest({ id: "t1", email: "a@x.com", credential_token: "c1" }),
          guest({ id: "t2", email: "b@x.com", credential_token: "c2" }),
        ],
      })
    );
    const res = await sendHouseholdTicketEmails("reg-1");
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });

  it("is idempotent: a group whose tickets were all already sent is skipped", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        guests: [guest({ id: "t1", email: "a@x.com", qr_email_sent_at: "2026-07-01T00:00:00Z" })],
      })
    );
    const res = await sendHouseholdTicketEmails("reg-1");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(stamped).toEqual([]);
    expect(res).toEqual({ groups: 0, sent: 0 });
  });

  it("best-effort: a send failure leaves qr_email_sent_at NULL (no stamp) and does not throw", async () => {
    mockedSend.mockResolvedValueOnce({ success: false, error: "boom" } as never);
    mockedAdmin.mockReturnValue(
      adminClient({ guests: [guest({ id: "t1", email: "a@x.com" })] })
    );
    const res = await sendHouseholdTicketEmails("reg-1");
    expect(stamped).toEqual([]); // not stamped → eligible for resend
    expect(res).toEqual({ groups: 1, sent: 0 });
  });

  it("skips guests without an email or credential token", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({
        guests: [
          guest({ id: "t1", email: null }),
          guest({ id: "t2", email: "a@x.com", credential_token: null }),
        ],
      })
    );
    const res = await sendHouseholdTicketEmails("reg-1");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(res).toEqual({ groups: 0, sent: 0 });
  });

  it("names the inviter when the booker isn't one of the group members", async () => {
    mockedAdmin.mockReturnValue(
      adminClient({ guests: [guest({ id: "t1", name: "Alice", email: "a@x.com" })] })
    );
    await sendHouseholdTicketEmails("reg-1");
    const model = mockedSend.mock.calls[0][0].templateModel as { inviter_name: string | null };
    expect(model.inviter_name).toBe("Booker Ben");
  });
});
