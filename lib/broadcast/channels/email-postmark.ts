import { getPostmarkClient } from "@/lib/postmark";
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
        },
        MessageStream: streamId,
      }));

      // Wrap each chunk so an error sending batch N does not lose the
      // results from batch N-1 — those recipients already got the email.
      let responses: Awaited<
        ReturnType<typeof client.sendEmailBatchWithTemplates>
      > = [];
      try {
        responses = await client.sendEmailBatchWithTemplates(batch);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Postmark batch failed";
        for (const recipient of chunk) {
          results.push({
            member_id: recipient.member_id,
            email: recipient.email,
            status: "failed",
            error: message,
          });
        }
        continue;
      }

      // Postmark returns one response per input row in order. Map back by
      // index; any unmatched recipients are recorded as failed with a clear
      // marker so the audit log never drops a row silently.
      chunk.forEach((recipient, idx) => {
        const res = responses[idx];
        if (!res) {
          results.push({
            member_id: recipient.member_id,
            email: recipient.email,
            status: "failed",
            error: "No response from Postmark for this recipient",
          });
          return;
        }
        const ok = res.ErrorCode === 0;
        results.push({
          member_id: recipient.member_id,
          email: recipient.email,
          status: ok ? "sent" : "failed",
          error: ok ? undefined : res.Message || `ErrorCode ${res.ErrorCode}`,
          provider_message_id: ok ? res.MessageID : undefined,
        });
      });
    }

    return results;
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
