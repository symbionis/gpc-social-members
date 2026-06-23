import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

// Admin action: resend the ticket/booking confirmation email for ONE registration.
// Built for existing registrants who booked before the per-ticket QR system (FEAT-41)
// and were never sent the new email, but reusable any time a lead loses their email.
//
// See docs/plans/2026-06-23-001-feat-resend-tickets-existing-registrants-plan.md (U3).

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin"];

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Unauthorized", status: 401 as const };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || !admin.id || !ALLOWED_ROLES.includes(admin.role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient, adminId: admin.id as string };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, regId } = await params;

  // Scope the lookup to BOTH the registration id and the path event so an admin can't
  // resend another event's registration through this route.
  const { data: registration, error: regErr } = await adminClient
    .from("event_registrations")
    .select("id, email, status")
    .eq("id", regId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();

  if (regErr) {
    console.error("[resend-confirmation] registration lookup failed", { eventId, regId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!registration) return bad("Registration not found", 404);

  // Only confirmed (paid/free) registrations have tickets to resend. A pending row
  // has no confirmed ticket email.
  if (registration.status !== "paid" && registration.status !== "free") {
    return bad("Only confirmed registrations have tickets to resend", 409);
  }

  let sent = false;
  try {
    const result = await sendEventRegistrationConfirmation(regId, { resend: true });
    sent = result.success;
  } catch (err) {
    console.error("[resend-confirmation] email send threw", { regId, err });
  }

  if (!sent) {
    return bad("Could not send the email. Please try again.", 502);
  }

  return NextResponse.json({ success: true, email: registration.email });
}
