import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

// Resend the ticket/booking email for one party from the door console. Public, keyed
// on the event id (same trust model as the rest of the door console — KTD1). A guest
// who can't find their QR at the door: staff resend the booking email (lead QR +
// booking page) to the lead's own address. No data is exposed to the operator beyond
// the roster they already see; the email goes only to the registrant.
//
// See docs/plans/2026-06-23-001-feat-resend-tickets-existing-registrants-plan.md.

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

  let body: { registrationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId.trim() : "";
  if (!registrationId) return bad("registrationId is required");

  const supabase = createAdminClient();

  // Scope the lookup to BOTH the registration id and the door's event so a door link
  // can only resend its own event's registrations.
  const { data: registration, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, email, status")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();

  if (regErr) {
    console.error("[door-resend] registration lookup failed", { eventId, registrationId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!registration) return bad("Booking not found", 404);
  if (registration.status !== "paid" && registration.status !== "free") {
    return bad("Only confirmed bookings have tickets to resend", 409);
  }

  let sent = false;
  try {
    const result = await sendEventRegistrationConfirmation(registrationId, { resend: true });
    sent = result.success;
  } catch (err) {
    console.error("[door-resend] email send threw", { eventId, registrationId, err });
  }

  if (!sent) return bad("Could not send the email. Please try again.", 502);

  return NextResponse.json({ success: true, email: registration.email });
}
