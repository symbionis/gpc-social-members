import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateReferenceCode,
  generateSelfRegToken,
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

  let body: { waitlistId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const waitlistId = typeof body.waitlistId === "string" ? body.waitlistId : "";
  if (!waitlistId) return bad("waitlistId is required");

  // Load the waitlist entry scoped to BOTH id and the path event — prevents
  // converting/deleting another event's entry. The desired ticket type +
  // quantity were captured at signup; the admin no longer re-enters a quantity.
  const { data: entry, error: entryErr } = await adminClient
    .from("event_waitlist")
    .select("id, name, email, ticket_type_id, quantity")
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

  // Resolve the ticket type for the line item. Use the entry's stored type when
  // present (even if archived — honor the waitlister's intent); otherwise (a
  // legacy entry, or a type since hard-deleted) fall back to the event's first
  // active type. Quantity comes from the entry, defaulting to 1 for legacy rows.
  let ticketTypeId = (entry.ticket_type_id as string | null) ?? null;
  let titleSnapshot = "Standard";
  if (ticketTypeId) {
    const { data: tt } = await adminClient
      .from("event_ticket_types")
      .select("id, title")
      .eq("id", ticketTypeId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (tt) titleSnapshot = tt.title;
    else ticketTypeId = null; // dangling reference → fall back below
  }
  if (!ticketTypeId) {
    const { data: fallback } = await adminClient
      .from("event_ticket_types")
      .select("id, title")
      .eq("event_id", eventId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!fallback) return bad("This event has no ticket type to convert into", 409);
    ticketTypeId = fallback.id;
    titleSnapshot = fallback.title;
  }
  const qty =
    Number.isInteger(entry.quantity) && (entry.quantity as number) >= 1
      ? (entry.quantity as number)
      : 1;

  // Comped (free) registration + one line item, atomically.
  const { data: registrationId, error: insertErr } = await adminClient.rpc(
    "create_event_registration",
    {
      p_event_id: eventId,
      p_name: name,
      p_email: email,
      p_is_member: Boolean(member),
      p_member_id: member?.id ?? null,
      p_status: "free",
      p_reference_code: referenceCode,
      p_paid_at: new Date().toISOString(),
      p_converted_by: adminId,
      p_items: [
        {
          ticket_type_id: ticketTypeId,
          title_snapshot: titleSnapshot,
          quantity: qty,
          unit_amount_chf: 0,
          line_total_chf: 0,
        },
      ],
    }
  );

  if (insertErr || !registrationId) {
    if (insertErr && (insertErr as { code?: string }).code === "23505") {
      return bad("This email is already registered for this event", 409);
    }
    console.error("[waitlist-convert] insert failed", { eventId, email, err: insertErr });
    return bad("Could not create registration", 500);
  }

  // Give the comped party a self-registration token (U9) so its guests can self-
  // register too. Best-effort: a failure only leaves this party without a link.
  const { error: tokenErr } = await adminClient
    .from("event_registrations")
    .update({ self_reg_token: generateSelfRegToken() })
    .eq("id", registrationId);
  if (tokenErr) {
    console.error("[waitlist-convert] failed to persist self_reg_token", {
      registrationId,
      err: tokenErr,
    });
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
    const emailResult = await sendWaitlistConfirmation(registrationId);
    emailSent = emailResult.success;
  } catch (err) {
    console.error("[waitlist-convert] email send threw", { regId: registrationId, err });
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
