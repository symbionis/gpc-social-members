import { getPostmarkClient, FROM_EMAIL } from "@/lib/postmark";
import { stripHtml } from "@/lib/broadcast/strip-html";
import { sendPostmarkBatch } from "@/lib/broadcast/channels/postmark-batch";
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

      // Shared per-batch send + response mapping (see broadcast channel).
      results.push(...(await sendPostmarkBatch(client, batch, chunk)));
    }

    return results;
  },
};
