import type { ServerClient } from "postmark";
import type { BroadcastRecipient, RecipientResult } from "@/lib/broadcast/types";

type BatchPayload = Parameters<ServerClient["sendEmailBatchWithTemplates"]>[0];

/**
 * Send one assembled Postmark batch (≤500) and map the responses back to
 * per-recipient results, index-aligned with `chunk`.
 *
 * On a batch-wide throw, records a `failed` result for every recipient in the
 * chunk so the audit trail never silently drops a row; on a missing or
 * error-coded per-row response, records that single recipient as `failed`.
 * Shared by the broadcast and transactional channel adapters — the only
 * difference between them is how the `batch` payload is assembled upstream
 * (stream, template, From, model), not how responses are handled.
 */
export async function sendPostmarkBatch(
  client: ServerClient,
  batch: BatchPayload,
  chunk: BroadcastRecipient[]
): Promise<RecipientResult[]> {
  const results: RecipientResult[] = [];

  let responses: Awaited<ReturnType<typeof client.sendEmailBatchWithTemplates>> = [];
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
    return results;
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

  return results;
}
