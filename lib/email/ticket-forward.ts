import { sendEmail } from "@/lib/postmark";

// Forwarding email (FEAT-41 / U5). When a lead forwards a batch of tickets to a
// delegate, that person gets an email with just those tickets and a link to their
// batch page (where each ticket's QR renders and they can name or hand on). The
// per-ticket QR images are embedded in U9; this sender carries the batch link + the
// ticket summary so the flow works end-to-end now. Best-effort — a delivery failure
// never fails the forward itself (the batch token is already stamped).

interface ForwardEmailInput {
  to: string;
  eventTitle: string;
  eventDateLabel: string | null;
  ticketCount: number;
  senderName: string | null;
  batchUrl: string;
}

const TEMPLATE_ALIAS = "event-ticket-forward";

export async function sendTicketForwardEmail(input: ForwardEmailInput) {
  const result = await sendEmail({
    to: input.to,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      event_title: input.eventTitle,
      event_date_label: input.eventDateLabel,
      ticket_count: input.ticketCount,
      // null (not "") so the Mustachio block is omitted when the lead has no name.
      sender_name: input.senderName || null,
      batch_url: input.batchUrl,
      preheader: `You've been sent ${input.ticketCount} ticket${
        input.ticketCount === 1 ? "" : "s"
      } for ${input.eventTitle}.`,
    },
  });
  if (!result.success) {
    console.error("[ticket-forward-email] sendEmail failed", input.to, result.error);
  }
  return result;
}
