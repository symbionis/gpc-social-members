import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateReferenceCode,
  findActiveMemberByEmail,
  hasExistingRegistration,
} from "@/lib/events/registration";
import { sendWaitlistConfirmation } from "@/lib/email/event-waitlist";
import { getSeatsUsed } from "@/lib/events/seat-usage";

// Admin action: promote an event_waitlist entry to a confirmed, comped (free)
// registration that overrides the seat cap, then notify the person and remove
// them from the waitlist.
//
// See docs/plans/2026-05-21-001-feat-waitlist-to-registration-plan.md (U3).

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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient, adminId } = auth;
  const { id: eventId } = await params;

  let body: { waitlistId?: unknown; quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const waitlistId = typeof body.waitlistId === "string" ? body.waitlistId : "";
  const quantity = body.quantity;
  if (!waitlistId) return bad("waitlistId is required");
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
    return bad("quantity must be an integer between 1 and 6");
  }

  // Load the waitlist entry scoped to BOTH id and the path event — prevents
  // converting/deleting another event's entry.
  const { data: entry, error: entryErr } = await adminClient
    .from("event_waitlist")
    .select("id, name, email")
    .eq("id", waitlistId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();

  if (entryErr) {
    console.error("[waitlist-convert] waitlist lookup failed", { eventId, waitlistId, err: entryErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!entry) return bad("Waitlist entry not found", 404);

  const email = String(entry.email).trim().toLowerCase();
  const name = String(entry.name).trim();

  // Fast-path duplicate guard; the partial unique index is the race-safe backstop.
  let alreadyRegistered: boolean;
  let member: { id: string } | null;
  try {
    alreadyRegistered = await hasExistingRegistration(eventId, email);
    member = alreadyRegistered ? null : await findActiveMemberByEmail(email);
  } catch (err) {
    console.error("[waitlist-convert] lookup failed", { eventId, email, err });
    return bad("Service temporarily unavailable", 503);
  }
  if (alreadyRegistered) {
    return bad("This email is already registered for this event", 409);
  }

  const referenceCode = generateReferenceCode();

  const { data: inserted, error: insertErr } = await adminClient
    .from("event_registrations")
    .insert({
      event_id: eventId,
      name,
      email,
      quantity,
      is_member: Boolean(member),
      member_id: member?.id ?? null,
      unit_amount_chf: 0,
      total_amount_chf: 0,
      status: "free",
      reference_code: referenceCode,
      paid_at: new Date().toISOString(),
      converted_by: adminId,
    })
    .select("id")
    .limit(1)
    .single();

  if (insertErr || !inserted) {
    // Race-safe: a concurrent duplicate hits the partial unique index → 23505.
    if (insertErr && (insertErr as { code?: string }).code === "23505") {
      return bad("This email is already registered for this event", 409);
    }
    console.error("[waitlist-convert] insert failed", { eventId, email, err: insertErr });
    return bad("Could not create registration", 500);
  }

  // Delete the waitlist entry (scoped). If this fails, the registration is the
  // source of truth and the Waitlist UI hides already-registered entries, so the
  // orphan self-heals — log and continue rather than rolling back.
  const { error: delErr } = await adminClient
    .from("event_waitlist")
    .delete()
    .eq("id", waitlistId)
    .eq("event_id", eventId);
  if (delErr) {
    console.error("[waitlist-convert] waitlist delete failed (registration kept)", {
      waitlistId,
      eventId,
      err: delErr,
    });
  }

  // Notify (awaited + reported, so the admin learns if it failed).
  let emailSent = false;
  try {
    const emailResult = await sendWaitlistConfirmation(inserted.id);
    emailSent = emailResult.success;
  } catch (err) {
    console.error("[waitlist-convert] email send threw", { regId: inserted.id, err });
  }

  let seatsUsed: number | null = null;
  try {
    seatsUsed = await getSeatsUsed(adminClient, eventId);
  } catch (err) {
    // Display-only; continue, but log so an RPC regression isn't masked.
    console.error("[waitlist-convert] seat count failed (non-fatal)", { eventId, err });
  }

  return NextResponse.json({
    success: true,
    reference_code: referenceCode,
    seats_used: seatsUsed,
    email_sent: emailSent,
  });
}
