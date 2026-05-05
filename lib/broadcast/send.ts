import { createAdminClient } from "@/lib/supabase/admin";
import { PostmarkEmailChannel } from "@/lib/broadcast/channels/email-postmark";
import { resolveAudience } from "@/lib/broadcast/audience";
import type {
  AudienceFilter,
  BroadcastChannel,
  BroadcastContent,
} from "@/lib/broadcast/types";

const CHANNELS: Record<string, BroadcastChannel> = {
  email: PostmarkEmailChannel,
};

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

/**
 * End-to-end broadcast dispatch:
 *   1. Resolve audience (consent-filtered).
 *   2. Insert broadcasts row with status='sending'.
 *   3. Hand recipients to the channel adapter.
 *   4. Persist per-recipient results to broadcast_recipients.
 *   5. Update broadcasts row with final counts and status.
 *
 * Returns aggregate counts for the API route to relay to the UI.
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
        audience_filter: input.audience_filter as unknown as Record<string, unknown>,
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
        audience_filter: input.audience_filter as unknown as Record<string, unknown>,
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

  const content: BroadcastContent = {
    subject: input.subject,
    body_html: input.body_html,
    body_text: input.body_text,
  };

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

  const { error: finalUpdateErr } = await supabase
    .from("broadcasts")
    .update({
      status: "sent",
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
