import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

// Resend ONE ticket's QR to the person holding it, from the door console. Public, keyed on
// the event id (same trust model as the rest of the door console — KTD1).
//
// Previously this resent the whole booking's confirmation to the LEAD's address, which was
// the wrong shape once tickets started following the person: the guest standing at the desk
// saying "I can't find my QR" is usually not the person who paid, so the email went to
// someone who may not even be present. Now it goes to the holder of the ticket in front of
// the operator, at their own address.
//
// The already-sent guard is deliberately bypassed. sendTicketQrEmail is idempotent on
// tickets.qr_email_sent_at so an automated retry can't double-send — but at the door the
// guest has by definition already been sent their QR once (that is why they are asking), so
// honouring the stamp would make this button do nothing in exactly the case it exists for.
// Clearing the stamp first turns it back into a real send. A human at the desk is the rate
// limit; there is no loop here to protect against.
//
// No data is exposed to the operator beyond the roster they already see — the response
// carries only the address it went to, and the email goes only to the holder.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  const event = await resolveDoorEvent(eventId);
  if (!event) return bad("Not available", 404);

  let body: { ticketId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const ticketId =
    typeof body.ticketId === "string" && UUID_RE.test(body.ticketId) ? body.ticketId : "";
  if (!ticketId) return bad("ticketId is required");

  const supabase = createAdminClient();

  // Scope the lookup to BOTH the ticket id and the door's event, so a door link can only
  // resend tickets for its own event.
  const { data: ticket, error: ticketErr } = await supabase
    .from("tickets")
    .select("id, email, released_at, credential_token")
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();

  if (ticketErr) {
    console.error("[door-resend] ticket lookup failed", { eventId, ticketId, err: ticketErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!ticket) return bad("Ticket not found", 404);
  if (ticket.released_at) return bad("That ticket is no longer active", 409);
  // Checked before clearing the stamp: no address means nothing to send to, and a cleared
  // stamp would leave the ticket looking un-notified for no reason.
  if (!ticket.email) return bad("That ticket has no email address to send to", 409);
  if (!ticket.credential_token) return bad("That ticket has no QR code yet", 409);

  // Clear the idempotency stamp so the send actually happens (see the note above). Best
  // effort on the failure path only: if this write fails, the send below will short-circuit
  // on `already_sent` and the operator gets a clear error rather than a silent no-op.
  const { error: clearErr } = await supabase
    .from("tickets")
    .update({ qr_email_sent_at: null })
    .eq("id", ticketId)
    .eq("event_id", eventId);
  if (clearErr) {
    console.error("[door-resend] could not clear qr_email_sent_at", { eventId, ticketId, err: clearErr });
    return bad("Could not send the email. Please try again.", 502);
  }

  let sent = false;
  try {
    const result = await sendTicketQrEmail(ticketId);
    sent = result.success;
    if (!result.success) {
      console.error("[door-resend] send did not complete", {
        eventId,
        ticketId,
        skipped: result.skipped,
      });
    }
  } catch (err) {
    console.error("[door-resend] email send threw", { eventId, ticketId, err });
  }

  if (!sent) return bad("Could not send the email. Please try again.", 502);

  return NextResponse.json({ success: true, email: ticket.email });
}
