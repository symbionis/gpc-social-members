import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/broadcast/event-audience", () => ({
  resolveEventAudience: vi.fn(),
}));
vi.mock("@/lib/broadcast/channels/email-transactional", () => ({
  TransactionalEmailChannel: { key: "email", send: vi.fn() },
}));

import { sendEventMessage } from "@/lib/broadcast/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEventAudience } from "@/lib/broadcast/event-audience";
import { TransactionalEmailChannel } from "@/lib/broadcast/channels/email-transactional";
import type { BroadcastRecipient } from "@/lib/broadcast/types";

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedResolve = vi.mocked(resolveEventAudience);
const mockedSend = vi.mocked(TransactionalEmailChannel.send);

function recipient(email: string): BroadcastRecipient {
  return { member_id: null, email, first_name: "X", last_name: "", tier_name: null };
}

interface SupabaseOpts {
  insertResult?: { data: { id: string } | null; error: unknown };
  existingRow?: Record<string, unknown> | null;
  onBroadcastInsert?: (payload: Record<string, unknown>) => void;
}

function supabase(opts: SupabaseOpts = {}) {
  return {
    from: (table: string) => {
      let isInsert = false;
      const c: Record<string, unknown> = {};
      c.insert = (payload: unknown) => {
        isInsert = true;
        if (table === "broadcasts")
          opts.onBroadcastInsert?.(payload as Record<string, unknown>);
        return c;
      };
      c.update = () => c;
      c.select = () => c;
      c.eq = () => c;
      c.limit = () => c;
      c.single = async () =>
        isInsert ? opts.insertResult ?? { data: { id: "b1" }, error: null } : { data: null, error: null };
      c.maybeSingle = async () => ({ data: opts.existingRow ?? null, error: null });
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return c;
    },
  } as unknown as ReturnType<typeof createAdminClient>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockResolvedValue({ recipients: [recipient("a@x.com")], skipped: 0 });
  mockedSend.mockResolvedValue([
    { member_id: null, email: "a@x.com", status: "sent", provider_message_id: "pm1" },
  ]);
});

describe("sendEventMessage — happy path and audit", () => {
  it("creates the event broadcast row and dispatches via the transactional channel", async () => {
    let captured: Record<string, unknown> | undefined;
    mockedResolve.mockResolvedValue({
      recipients: [recipient("a@x.com"), recipient("b@x.com")],
      skipped: 1,
    });
    mockedSend.mockResolvedValue([
      { member_id: null, email: "a@x.com", status: "sent" },
      { member_id: null, email: "b@x.com", status: "sent" },
    ]);
    mockedCreateAdminClient.mockReturnValue(
      supabase({ onBroadcastInsert: (p) => (captured = p) })
    );

    const out = await sendEventMessage({
      event_id: "e1",
      kind: "event_post",
      subject: "Thanks",
      body_html: "<p>Thanks for coming</p>",
      include_non_consented: true,
      created_by: "admin-1",
      idempotency_key: "key-1",
    });

    expect(out.status).toBe("sent");
    if (out.status !== "sent") throw new Error("unreachable");
    expect(out.result).toMatchObject({ recipient_count: 2, sent: 2, failed: 0, skipped: 1 });
    expect(mockedSend).toHaveBeenCalledOnce();
    // AE3: the override is recorded on the row's audience_filter.
    expect(captured).toMatchObject({
      event_id: "e1",
      kind: "event_post",
      status: "sending",
      recipient_count: 2,
      skipped_count: 1,
      idempotency_key: "key-1",
      audience_filter: { kind: "event_post", event_id: "e1", include_non_consented: true },
    });
  });

  it("forces include_non_consented false for pre-event regardless of input", async () => {
    let captured: Record<string, unknown> | undefined;
    mockedCreateAdminClient.mockReturnValue(
      supabase({ onBroadcastInsert: (p) => (captured = p) })
    );
    await sendEventMessage({
      event_id: "e1",
      kind: "event_pre",
      subject: "Heads up",
      body_html: "<p>Venue moved</p>",
      include_non_consented: true, // ignored for pre-event
      created_by: "admin-1",
    });
    expect((captured?.audience_filter as Record<string, unknown>).include_non_consented).toBe(false);
  });

  it("records a partial failure (failed > 0) but still finalises as sent", async () => {
    mockedResolve.mockResolvedValue({
      recipients: [recipient("a@x.com"), recipient("b@x.com")],
      skipped: 0,
    });
    mockedSend.mockResolvedValue([
      { member_id: null, email: "a@x.com", status: "sent" },
      { member_id: null, email: "b@x.com", status: "failed", error: "bounce" },
    ]);
    mockedCreateAdminClient.mockReturnValue(supabase());

    const out = await sendEventMessage({
      event_id: "e1",
      kind: "event_post",
      subject: "s",
      body_html: "<p>b</p>",
      created_by: "admin-1",
    });
    if (out.status !== "sent") throw new Error("expected sent");
    expect(out.result).toMatchObject({ sent: 1, failed: 1 });
  });
});

describe("sendEventMessage — empty audience", () => {
  it("short-circuits to a zero-recipient sent result without calling the channel", async () => {
    mockedResolve.mockResolvedValue({ recipients: [], skipped: 0 });
    mockedCreateAdminClient.mockReturnValue(supabase());
    const out = await sendEventMessage({
      event_id: "e1",
      kind: "event_post",
      subject: "s",
      body_html: "<p>b</p>",
      created_by: "admin-1",
    });
    if (out.status !== "sent") throw new Error("expected sent");
    expect(out.result.recipient_count).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});

describe("sendEventMessage — adapter-wide failure", () => {
  it("rethrows when the channel throws (e.g. missing template/env)", async () => {
    mockedSend.mockRejectedValue(new Error("POSTMARK down"));
    mockedCreateAdminClient.mockReturnValue(supabase());
    await expect(
      sendEventMessage({
        event_id: "e1",
        kind: "event_post",
        subject: "s",
        body_html: "<p>b</p>",
        created_by: "admin-1",
      })
    ).rejects.toThrow("POSTMARK down");
  });
});

describe("sendEventMessage — double-send guard (23505)", () => {
  it("reports in_progress on an in-flight (event_id, kind) collision", async () => {
    mockedCreateAdminClient.mockReturnValue(
      supabase({
        insertResult: {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "broadcasts_event_inflight_uniq"',
          },
        },
      })
    );
    const out = await sendEventMessage({
      event_id: "e1",
      kind: "event_pre",
      subject: "s",
      body_html: "<p>b</p>",
      created_by: "admin-1",
    });
    expect(out.status).toBe("in_progress");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("returns the existing send's result on an idempotency-key collision", async () => {
    mockedCreateAdminClient.mockReturnValue(
      supabase({
        insertResult: {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "broadcasts_idempotency_key_uniq"',
          },
        },
        existingRow: { id: "b9", recipient_count: 5, error_count: 1, skipped_count: 2 },
      })
    );
    const out = await sendEventMessage({
      event_id: "e1",
      kind: "event_post",
      subject: "s",
      body_html: "<p>b</p>",
      created_by: "admin-1",
      idempotency_key: "key-retry",
    });
    expect(out.status).toBe("duplicate");
    if (out.status !== "duplicate") throw new Error("unreachable");
    expect(out.result).toMatchObject({ broadcast_id: "b9", sent: 4, failed: 1, skipped: 2 });
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
