import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";

// Admin action: resend the ticket/booking email to every confirmed registration on
// this event that has NOT yet been sent the new email (ticket_email_sent_at IS NULL).
// One click to notify all existing registrants who booked before the per-ticket QR
// system (FEAT-41). Idempotent: each send stamps the row, so a re-run skips it.
//
// See docs/plans/2026-06-23-001-feat-resend-tickets-existing-registrants-plan.md (U5).

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

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

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  // Target only confirmed registrations that have never been sent the ticket email.
  // NULL ticket_email_sent_at is the "not yet notified" signal; the per-send stamp
  // makes this set shrink on each run, so re-running never double-sends.
  const { data: registrations, error: regErr } = await adminClient
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .is("ticket_email_sent_at", null);

  if (regErr) {
    console.error("[resend-bulk] registration lookup failed", { eventId, err: regErr });
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }

  const targets = registrations ?? [];
  let sent = 0;
  let failed = 0;

  // Sequential: the recipient set is small (existing registrants on one event) and a
  // serial loop keeps Postmark calls well within rate limits without batching.
  for (const r of targets) {
    try {
      const result = await sendEventRegistrationConfirmation(r.id as string, { resend: true });
      if (result.success) sent++;
      else failed++;
    } catch (err) {
      console.error("[resend-bulk] send threw", { eventId, regId: r.id, err });
      failed++;
    }
  }

  return NextResponse.json({ success: true, sent, failed, total: targets.length });
}
