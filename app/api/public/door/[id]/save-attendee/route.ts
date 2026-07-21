import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

// Door console: fill in or edit one ticket slot of a party (U14). Front-door staff
// capture a guest's details on the spot instead of waiting for self-registration.
// Public, keyed on the event id (KTD1). With an attendeeId it edits that person's
// name/contact; without one it creates a person for an open slot of a ticket type
// (race-checked against the per-type allotment). Every slot needs an email or phone
// so they match at the door — no exemption for a former child type (R6).

const MAX_LEN = 200;
const MAX_EMAIL_LEN = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
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

  let body: {
    attendeeId?: unknown;
    registrationId?: unknown;
    ticketTypeId?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const attendeeId =
    typeof body.attendeeId === "string" && UUID_RE.test(body.attendeeId) ? body.attendeeId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (!name) return bad("a name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (email && (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN)) {
    return bad("a valid email is required");
  }
  if (phone && !PHONE_RE.test(phone)) return bad("a valid phone is required");

  const supabase = createAdminClient();

  // ----- Edit an existing slot -----
  if (attendeeId) {
    const { data: existing, error: exErr } = await supabase
      .from("tickets")
      .select("id, checked_in_at")
      .eq("id", attendeeId)
      .eq("event_id", eventId)
      .eq("slot_status", "claimed")
      .is("released_at", null)
      .limit(1)
      .maybeSingle();
    if (exErr) {
      console.error("[door-save] lookup failed", { eventId, attendeeId, err: exErr });
      return bad("Service temporarily unavailable", 503);
    }
    if (!existing) return bad("Slot not found", 404);

    // A guest who hasn't arrived must keep a contact (so they match at the door) —
    // no more exemption for a former child type (R6). An arrived guest is already
    // physically present and verified, so that exemption is unrelated and stays.
    const checkedIn = existing.checked_in_at !== null;
    if (!checkedIn && !email && !phone) {
      return bad("Add an email or phone, or use the QR code", 400);
    }

    const { error: upErr } = await supabase
      .from("tickets")
      .update({ name, email: email || null, phone_e164: phone || null })
      .eq("id", attendeeId)
      .eq("event_id", eventId);
    if (upErr) {
      console.error("[door-save] update failed", { eventId, attendeeId, err: upErr });
      return bad("Could not save", 500);
    }
    return NextResponse.json({ ok: true, attendeeId, created: false });
  }

  // ----- Fill an open slot: flip an issued ticket → claimed via the locked RPC -----
  const registrationId =
    typeof body.registrationId === "string" && UUID_RE.test(body.registrationId)
      ? body.registrationId
      : "";
  const ticketTypeId =
    typeof body.ticketTypeId === "string" && UUID_RE.test(body.ticketTypeId)
      ? body.ticketTypeId
      : "";
  if (!registrationId) return bad("registrationId is required");
  if (!ticketTypeId) return bad("ticketTypeId is required");

  // Scope the party to THIS event before mutating it (the RPC keys only on the
  // registration id — a door console for event A must not fill event B's party).
  const { data: reg, error: regErr } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .limit(1)
    .maybeSingle();
  if (regErr) {
    console.error("[door-save] reg lookup failed", { eventId, registrationId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!reg) return bad("Party not found", 404);

  // The RPC holds the registration lock, enforces the per-type cap on CLAIMED rows
  // (issued rows are capacity, not redemptions), flips one issued row to claimed, and
  // is idempotent on contact. It allows a child ticket name-only and requires contact
  // otherwise — mirroring the old route guard.
  const { data: result, error: claimErr } = await supabase.rpc("claim_ticket", {
    p_registration_id: registrationId,
    p_name: name,
    p_email: email || null,
    p_phone_e164: phone || null,
    p_language: null,
    p_waiver_version: null,
    p_waiver_accepted: false,
    p_marketing_consent: null,
    p_ticket_type_id: ticketTypeId,
  });
  if (claimErr) {
    console.error("[door-save] claim_ticket failed", { registrationId, ticketTypeId, err: claimErr });
    return bad("Could not save", 500);
  }
  const claim = (result ?? {}) as { status?: string; attendee_id?: string; already?: boolean };
  switch (claim.status) {
    case "claimed":
      return NextResponse.json({
        ok: true,
        attendeeId: claim.attendee_id,
        created: !claim.already,
      });
    case "full":
    case "type_full":
      return bad("That ticket type is already full for this party", 409);
    case "invalid_input":
      return bad("Add an email or phone, or use the QR code", 400);
    case "inactive":
    case "invalid":
    default:
      return bad("Party not found", 404);
  }
}
