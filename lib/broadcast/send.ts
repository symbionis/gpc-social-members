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
}

export interface SendBroadcastResult {
  broadcast_id: string;
  recipient_count: number;
  sent: number;
  failed: number;
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

  const recipients = await resolveAudience(input.audience_filter);

  const { data: inserted, error: insertErr } = await supabase
    .from("broadcasts")
    .insert({
      subject: input.subject,
      body_html: input.body_html,
      audience_filter: input.audience_filter as unknown as Record<string, unknown>,
      channel: channelKey,
      status: "sending",
      recipient_count: recipients.length,
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

  const broadcastId = inserted.id;

  // Empty audience: finalise immediately, no adapter call.
  if (recipients.length === 0) {
    await supabase
      .from("broadcasts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        error_count: 0,
      })
      .eq("id", broadcastId);

    return {
      broadcast_id: broadcastId,
      recipient_count: 0,
      sent: 0,
      failed: 0,
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
    // Adapter-wide failure (e.g. missing env, network down). Mark broadcast
    // failed and rethrow so the route layer surfaces the error to the admin.
    await supabase
      .from("broadcasts")
      .update({
        status: "failed",
        sent_at: new Date().toISOString(),
        error_count: recipients.length,
      })
      .eq("id", broadcastId);
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

  await supabase
    .from("broadcasts")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      error_count: failed.length,
    })
    .eq("id", broadcastId);

  return {
    broadcast_id: broadcastId,
    recipient_count: recipients.length,
    sent,
    failed: failed.length,
    errors: failed.map((f) => ({
      email: f.email,
      error: f.error ?? "Unknown error",
    })),
  };
}
