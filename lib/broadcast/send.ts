import { createAdminClient } from "@/lib/supabase/admin";
import { PostmarkEmailChannel } from "@/lib/broadcast/channels/email-postmark";
import { TransactionalEmailChannel } from "@/lib/broadcast/channels/email-transactional";
import { resolveAudience } from "@/lib/broadcast/audience";
import {
  resolveEventAudience,
  type EventMessageKind,
} from "@/lib/broadcast/event-audience";
import type {
  AudienceFilter,
  BroadcastChannel,
  BroadcastContent,
  BroadcastRecipient,
} from "@/lib/broadcast/types";

const CHANNELS: Record<string, BroadcastChannel> = {
  email: PostmarkEmailChannel,
};

/** A broadcast still at status='sending' older than this is treated as a dead
 *  in-flight send (process killed mid-dispatch) and reset so the event-send
 *  in-flight guard can't wedge an event+kind permanently. Real sends finalise
 *  in seconds, so this window only ever catches genuinely-dead rows. */
const STALE_SENDING_MS = 10 * 60 * 1000;

export interface SendBroadcastInput {
  subject: string;
  body_html: string;
  body_text?: string;
  audience_filter: AudienceFilter;
  channel?: keyof typeof CHANNELS;
  created_by: string;
  /** If provided, the existing broadcasts row (typically status='draft') is
   *  transitioned through `sending → sent`/`failed` instead of inserting a
   *  new row. Prevents orphaned drafts after send. */
  broadcast_id?: string;
}

export interface SendBroadcastResult {
  broadcast_id: string;
  recipient_count: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * End-to-end member broadcast dispatch:
 *   1. Resolve audience (consent-filtered).
 *   2. Insert broadcasts row with status='sending'.
 *   3. Dispatch + persist via the shared core.
 *
 * Returns aggregate counts for the API route to relay to the UI. Behavior is
 * unchanged from before the event-messaging refactor — the post-row-creation
 * work now lives in `dispatchToChannel`, shared with `sendEventMessage`.
 */
export async function sendBroadcast(
  input: SendBroadcastInput
): Promise<SendBroadcastResult> {
  const supabase = createAdminClient();
  const channelKey = input.channel ?? "email";
  const channel = CHANNELS[channelKey];

  if (!channel) {
    throw new Error(`Unknown broadcast channel: ${channelKey}`);
  }

  const { recipients, skipped } = await resolveAudience(input.audience_filter);
  const audienceFilter = input.audience_filter as unknown as Record<string, unknown>;

  let broadcastId: string;
  if (input.broadcast_id) {
    // Transition an existing draft row through 'sending' rather than
    // inserting a new row. Snapshot the latest content/audience too in case
    // the caller is sending without a final PATCH.
    const { data: updated, error: updateErr } = await supabase
      .from("broadcasts")
      .update({
        subject: input.subject,
        body_html: input.body_html,
        audience_filter: audienceFilter,
        channel: channelKey,
        status: "sending",
        recipient_count: recipients.length,
        skipped_count: skipped,
      })
      .eq("id", input.broadcast_id)
      .select("id")
      .limit(1)
      .single();
    if (updateErr || !updated) {
      throw new Error(
        `Failed to claim draft for send: ${updateErr?.message ?? "no row returned"}`
      );
    }
    broadcastId = updated.id;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("broadcasts")
      .insert({
        subject: input.subject,
        body_html: input.body_html,
        audience_filter: audienceFilter,
        channel: channelKey,
        status: "sending",
        recipient_count: recipients.length,
        skipped_count: skipped,
        created_by: input.created_by,
      })
      .select("id")
      .limit(1)
      .single();

    if (insertErr || !inserted) {
      throw new Error(
        `Failed to create broadcast row: ${insertErr?.message ?? "no row returned"}`
      );
    }
    broadcastId = inserted.id;
  }

  return dispatchToChannel({
    supabase,
    broadcastId,
    recipients,
    skipped,
    channel,
    content: {
      subject: input.subject,
      body_html: input.body_html,
      body_text: input.body_text,
    },
  });
}

export interface SendEventMessageInput {
  event_id: string;
  kind: EventMessageKind;
  subject: string;
  body_html: string;
  body_text?: string;
  /** event_post only: include attendees who did not opt in (transactional). */
  include_non_consented?: boolean;
  created_by: string;
  /** Client-supplied key; a retried request reuses it and is de-duplicated. */
  idempotency_key?: string | null;
}

export type SendEventMessageResult =
  | { status: "sent"; result: SendBroadcastResult }
  /** A request with the same idempotency_key already ran — existing result returned. */
  | { status: "duplicate"; result: SendBroadcastResult }
  /** Another send for this event+kind is in flight (in-flight guard collision). */
  | { status: "in_progress" };

/**
 * Send an event-scoped message (pre-event to registered attendees, post-event
 * to checked-in attendees) through the transactional channel, reusing the
 * broadcast row + per-recipient audit + dispatch core.
 *
 * Double-send guards live on the broadcasts insert (partial unique indexes from
 * the event-messaging migration). A 23505 here is classified as benign:
 *   - idempotency_key collision → return the existing send's result
 *   - in-flight (event_id, kind) collision → report in_progress
 * Never a thrown 500 for those — same posture as the reminder idempotency path.
 */
export async function sendEventMessage(
  input: SendEventMessageInput
): Promise<SendEventMessageResult> {
  const supabase = createAdminClient();

  const includeNonConsented =
    input.kind === "event_post" ? input.include_non_consented ?? false : false;

  const { recipients, skipped } = await resolveEventAudience({
    event_id: input.event_id,
    kind: input.kind,
    include_non_consented: includeNonConsented,
  });

  const audienceFilter: Record<string, unknown> = {
    kind: input.kind,
    event_id: input.event_id,
    include_non_consented: includeNonConsented,
  };

  // Self-heal a wedged in-flight row before inserting. If a prior send for this
  // event+kind died mid-dispatch (serverless timeout, OOM, deploy), its row is
  // stuck at status='sending' and the in-flight partial unique index would
  // block every future send. A real send finalises in seconds, so a 'sending'
  // row older than the stale window is dead — flip it to 'failed' so the guard
  // releases. Recent in-flight rows are untouched, preserving the guard.
  await supabase
    .from("broadcasts")
    .update({ status: "failed" })
    .eq("event_id", input.event_id)
    .eq("kind", input.kind)
    .eq("status", "sending")
    .lt("created_at", new Date(Date.now() - STALE_SENDING_MS).toISOString());

  const { data: inserted, error: insertErr } = await supabase
    .from("broadcasts")
    .insert({
      subject: input.subject,
      body_html: input.body_html,
      audience_filter: audienceFilter,
      channel: "email",
      status: "sending",
      recipient_count: recipients.length,
      skipped_count: skipped,
      created_by: input.created_by,
      event_id: input.event_id,
      kind: input.kind,
      idempotency_key: input.idempotency_key ?? null,
    })
    .select("id")
    .limit(1)
    .single();

  if (insertErr || !inserted) {
    if ((insertErr as { code?: string } | null)?.code === "23505") {
      return classifyGuardCollision(supabase, input.event_id, input.idempotency_key ?? null);
    }
    throw new Error(
      `Failed to create event broadcast row: ${insertErr?.message ?? "no row returned"}`
    );
  }

  const result = await dispatchToChannel({
    supabase,
    broadcastId: inserted.id,
    recipients,
    skipped,
    channel: TransactionalEmailChannel,
    content: {
      subject: input.subject,
      body_html: input.body_html,
      body_text: input.body_text,
    },
  });

  return { status: "sent", result };
}

/** Interpret a 23505 on the event-send insert without depending on which
 *  constraint Postgres reported (locale- and ordering-fragile). When the
 *  request carried an idempotency_key, a row with that key for this event means
 *  it's a retry — return the original send's result. Scoped to event_id so a
 *  reused key from a different event can't return the wrong send's data. No
 *  matching row means the collision was the in-flight guard. */
async function classifyGuardCollision(
  supabase: AdminClient,
  eventId: string,
  idempotencyKey: string | null
): Promise<SendEventMessageResult> {
  if (idempotencyKey !== null) {
    const { data: existing } = await supabase
      .from("broadcasts")
      .select("id, recipient_count, error_count, skipped_count")
      .eq("event_id", eventId)
      .eq("idempotency_key", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        status: "duplicate",
        result: {
          broadcast_id: existing.id,
          recipient_count: existing.recipient_count,
          sent: Math.max(existing.recipient_count - existing.error_count, 0),
          failed: existing.error_count,
          skipped: existing.skipped_count,
          errors: [],
        },
      };
    }
  }

  return { status: "in_progress" };
}

/**
 * Shared post-row dispatch: hand recipients to the channel, persist the
 * per-recipient audit trail, and finalise the broadcasts row. Identical for
 * member and event sends — the only difference upstream is how the row and
 * recipients were produced.
 */
async function dispatchToChannel(opts: {
  supabase: AdminClient;
  broadcastId: string;
  recipients: BroadcastRecipient[];
  skipped: number;
  channel: BroadcastChannel;
  content: BroadcastContent;
}): Promise<SendBroadcastResult> {
  const { supabase, broadcastId, recipients, skipped, channel, content } = opts;

  // Empty audience: finalise immediately, no adapter call.
  if (recipients.length === 0) {
    const { error: emptyUpdateErr } = await supabase
      .from("broadcasts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        error_count: 0,
      })
      .eq("id", broadcastId);
    if (emptyUpdateErr) {
      console.error(
        "[broadcast] failed to finalise empty broadcast row",
        emptyUpdateErr
      );
    }
    return {
      broadcast_id: broadcastId,
      recipient_count: 0,
      sent: 0,
      failed: 0,
      skipped,
      errors: [],
    };
  }

  let results;
  try {
    results = await channel.send(recipients, content);
  } catch (err) {
    // Adapter-wide failure (e.g. missing env, network down). Persist a
    // failed row for every recipient so the audit log matches the broadcast
    // counts, then mark the broadcast failed and rethrow.
    const errMessage = err instanceof Error ? err.message : "Channel send failed";
    const failedRows = recipients.map((r) => ({
      broadcast_id: broadcastId,
      member_id: r.member_id,
      email: r.email,
      status: "failed",
      error: errMessage,
      provider_message_id: null,
    }));
    if (failedRows.length > 0) {
      const { error: insErr } = await supabase
        .from("broadcast_recipients")
        .insert(failedRows);
      if (insErr) {
        console.error(
          "[broadcast] failed to persist adapter-error recipient rows",
          insErr
        );
      }
    }
    const { error: failUpdateErr } = await supabase
      .from("broadcasts")
      .update({
        status: "failed",
        sent_at: new Date().toISOString(),
        error_count: recipients.length,
      })
      .eq("id", broadcastId);
    if (failUpdateErr) {
      console.error(
        "[broadcast] failed to mark broadcast as failed",
        failUpdateErr
      );
    }
    throw err;
  }

  // Persist per-recipient delivery log.
  const recipientRows = results.map((r) => ({
    broadcast_id: broadcastId,
    member_id: r.member_id,
    email: r.email,
    status: r.status,
    error: r.error ?? null,
    provider_message_id: r.provider_message_id ?? null,
  }));

  if (recipientRows.length > 0) {
    const { error: recipientErr } = await supabase
      .from("broadcast_recipients")
      .insert(recipientRows);
    if (recipientErr) {
      console.error(
        "[broadcast] Failed to persist per-recipient rows",
        recipientErr
      );
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  const sent = results.length - failed.length;

  // If every recipient failed (e.g. a missing Postmark template returns a
  // per-row error rather than throwing), the send delivered nothing — record it
  // as 'failed', not 'sent', so the comms log doesn't claim a phantom success.
  const finalStatus = sent === 0 ? "failed" : "sent";

  const { error: finalUpdateErr } = await supabase
    .from("broadcasts")
    .update({
      status: finalStatus,
      sent_at: new Date().toISOString(),
      error_count: failed.length,
    })
    .eq("id", broadcastId);
  if (finalUpdateErr) {
    console.error(
      "[broadcast] failed to finalise broadcast row",
      finalUpdateErr
    );
  }

  return {
    broadcast_id: broadcastId,
    recipient_count: recipients.length,
    sent,
    failed: failed.length,
    skipped,
    errors: failed.map((f) => ({
      email: f.email,
      error: f.error ?? "Unknown error",
    })),
  };
}
