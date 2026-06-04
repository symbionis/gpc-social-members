import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

// Door console: fill in or edit one ticket slot of a party (U14). Front-door staff
// capture a guest's details on the spot instead of waiting for self-registration.
// Public, keyed on the event id (KTD1). With an attendeeId it edits that person's
// name/contact; without one it creates a person for an open slot of a ticket type
// (race-checked against the per-type allotment). A children's-ticket slot is name
// only (contactless); an adult slot needs an email or phone so they match at the door.

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
      .from("event_attendees")
      .select("id, is_child, checked_in_at")
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

    // An adult who hasn't arrived must keep a contact (so they match at the door).
    const isChild = Boolean(existing.is_child);
    const checkedIn = existing.checked_in_at !== null;
    if (!isChild && !checkedIn && !email && !phone) {
      return bad("Add an email or phone, or use the QR code", 400);
    }

    const { error: upErr } = await supabase
      .from("event_attendees")
      .update({ name, email: email || null, phone_e164: phone || null })
      .eq("id", attendeeId)
      .eq("event_id", eventId);
    if (upErr) {
      console.error("[door-save] update failed", { eventId, attendeeId, err: upErr });
      return bad("Could not save", 500);
    }
    return NextResponse.json({ ok: true, attendeeId, created: false });
  }

  // ----- Fill an open slot (create) -----
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

  // The party must belong to this event and be confirmed.
  const { data: reg, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, status")
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

  // The ticket type must belong to this event; its child flag drives the contact rule.
  const { data: type, error: typeErr } = await supabase
    .from("event_ticket_types")
    .select("id, is_child")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .limit(1)
    .maybeSingle();
  if (typeErr) {
    console.error("[door-save] type lookup failed", { eventId, ticketTypeId, err: typeErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!type) return bad("Ticket type not found", 404);
  const isChild = Boolean(type.is_child);

  if (!isChild && !email && !phone) {
    return bad("Add an email or phone, or use the QR code", 400);
  }

  // Per-type allotment: claimed of this type may not exceed purchased of this type.
  const { data: items, error: itemsErr } = await supabase
    .from("event_registration_items")
    .select("quantity")
    .eq("registration_id", registrationId)
    .eq("ticket_type_id", ticketTypeId);
  if (itemsErr) {
    console.error("[door-save] items lookup failed", { registrationId, ticketTypeId, err: itemsErr });
    return bad("Service temporarily unavailable", 503);
  }
  const purchased = (items ?? []).reduce((sum, r) => sum + ((r.quantity as number | null) ?? 0), 0);

  const { count, error: countErr } = await supabase
    .from("event_attendees")
    .select("id", { count: "exact", head: true })
    .eq("registration_id", registrationId)
    .eq("ticket_type_id", ticketTypeId)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  if (countErr) {
    console.error("[door-save] count failed", { registrationId, ticketTypeId, err: countErr });
    return bad("Service temporarily unavailable", 503);
  }
  if ((count ?? 0) >= purchased) {
    return bad("That ticket type is already full for this party", 409);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("event_attendees")
    .insert({
      event_id: eventId,
      registration_id: registrationId,
      name,
      email: email || null,
      phone_e164: phone || null,
      is_lead: false,
      is_child: isChild,
      slot_status: "claimed",
      ticket_type_id: ticketTypeId,
    })
    .select("id")
    .limit(1);
  if (insErr || !inserted || inserted.length === 0) {
    console.error("[door-save] insert failed", { registrationId, ticketTypeId, err: insErr });
    return bad("Could not save", 500);
  }
  return NextResponse.json({ ok: true, attendeeId: inserted[0].id, created: true });
}
