import { getPostmarkClient } from "@/lib/postmark";
import { stripHtml } from "@/lib/broadcast/strip-html";
import { sendPostmarkBatch } from "@/lib/broadcast/channels/postmark-batch";
import type {
  BroadcastChannel,
  BroadcastContent,
  BroadcastRecipient,
  RecipientResult,
} from "@/lib/broadcast/types";

const POSTMARK_BATCH_LIMIT = 500;
const TEMPLATE_ALIAS = "members-comms-broadcast";

/**
 * Postmark broadcast-stream adapter. Fans recipients out using
 * `sendEmailBatchWithTemplates` against the broadcast stream so deliverability
 * stays separated from the transactional stream and Postmark auto-injects the
 * unsubscribe footer required for marketing email.
 *
 * Postmark accepts up to 500 messages per batch call; this adapter chunks
 * larger audiences and serialises the batches to honour Postmark's
 * recommendation of ≤10 concurrent connections per server.
 */
export const PostmarkEmailChannel: BroadcastChannel = {
  key: "email",

  async send(
    recipients: BroadcastRecipient[],
    content: BroadcastContent
  ): Promise<RecipientResult[]> {
    if (recipients.length === 0) return [];

    const streamId = process.env.POSTMARK_BROADCAST_STREAM_ID;
    const fromAddress = process.env.POSTMARK_BROADCAST_FROM;

    if (!streamId) {
      throw new Error(
        "POSTMARK_BROADCAST_STREAM_ID is not set — cannot send broadcast"
      );
    }
    if (!fromAddress) {
      throw new Error(
        "POSTMARK_BROADCAST_FROM is not set — cannot send broadcast"
      );
    }

    const client = getPostmarkClient();
    const results: RecipientResult[] = [];

    for (let i = 0; i < recipients.length; i += POSTMARK_BATCH_LIMIT) {
      const chunk = recipients.slice(i, i + POSTMARK_BATCH_LIMIT);

      const batch = chunk.map((r) => ({
        From: fromAddress,
        To: r.email,
        TemplateAlias: TEMPLATE_ALIAS,
        TemplateModel: {
          subject: content.subject,
          body_html: content.body_html,
          body_text: content.body_text ?? stripHtml(content.body_html),
          first_name: r.first_name,
          last_name: r.last_name,
          tier_name: r.tier_name ?? "",
          email: r.email,
        },
        MessageStream: streamId,
      }));

      // Per-batch send + response mapping (failed-row recording on a batch-wide
      // throw, index-aligned per-recipient results) is shared with the
      // transactional channel.
      results.push(...(await sendPostmarkBatch(client, batch, chunk)));
    }

    return results;
  },
};
