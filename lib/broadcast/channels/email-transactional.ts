import { getPostmarkClient, FROM_EMAIL } from "@/lib/postmark";
import { stripHtml } from "@/lib/broadcast/strip-html";
import type {
  BroadcastChannel,
  BroadcastContent,
  BroadcastRecipient,
  RecipientResult,
} from "@/lib/broadcast/types";

const POSTMARK_BATCH_LIMIT = 500;
const TEMPLATE_ALIAS = "event-message";

/**
 * Transactional email adapter for event messages (pre-event logistics,
 * post-event thank-yous).
 *
 * Unlike the broadcast adapter, this sends from the transactional sender
 * (`social@`) on the **default** message stream — no `MessageStream: broadcast`
 * — and uses the `event-message` template, which wraps the admin's body in the
 * main Geneva Polo layout with NO marketing unsubscribe footer. Event-specific
 * comms are transactional: recipients have a direct relationship to the event,
 * and consent is enforced at audience selection, not via an unsubscribe link.
 *
 * Same fan-out shape as the broadcast adapter: ≤500 per batch, serialised, with
 * per-batch try/catch so a failing batch never drops earlier batches' audit
 * rows. `key` stays "email" — this is an email channel, distinguished from the
 * broadcast adapter by which stream/template it dispatches through, not by key.
 */
export const TransactionalEmailChannel: BroadcastChannel = {
  key: "email",

  async send(
    recipients: BroadcastRecipient[],
    content: BroadcastContent
  ): Promise<RecipientResult[]> {
    if (recipients.length === 0) return [];

    const client = getPostmarkClient();
    const results: RecipientResult[] = [];
    const bodyText = content.body_text ?? stripHtml(content.body_html);

    for (let i = 0; i < recipients.length; i += POSTMARK_BATCH_LIMIT) {
      const chunk = recipients.slice(i, i + POSTMARK_BATCH_LIMIT);

      const batch = chunk.map((r) => ({
        From: FROM_EMAIL,
        To: r.email,
        TemplateAlias: TEMPLATE_ALIAS,
        TemplateModel: {
          subject: content.subject,
          body_html: content.body_html,
          body_text: bodyText,
          // Greeting fallback: pass null (not "") so the Mustachio template can
          // branch with {{#first_name}}…{{/first_name}} / {{^first_name}}.
          first_name: r.first_name?.trim() ? r.first_name : null,
          email: r.email,
        },
        // No MessageStream → default transactional/outbound stream.
      }));

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
