import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

// Add an accompanying guest at the door (U11 / contactless arrivals). A parent
// turns up with a child (or any contactless guest) who can't self-register; door
// staff add them by name and they're recorded as arrived immediately. Public,
// keyed on the event id (KTD1). Name-only, no contact, no waiver (children don't
// sign). Tied to the party so it counts toward fill. Refuses if the party is
// already full (over-capacity → welcome desk, as agreed).

const MAX_LEN = 200;

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

  let body: { registrationId?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!registrationId) return bad("registrationId is required");
  if (!name) return bad("a name is required");
  if (name.length > MAX_LEN) return bad("name is too long");

  const supabase = createAdminClient();

  // The party must belong to this event and be confirmed; capacity = its quantity.
  const { data: reg, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, quantity, status")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .limit(1)
    .maybeSingle();
  if (regErr) {
    console.error("[door-add-guest] reg lookup failed", { eventId, registrationId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!reg) return bad("Party not found", 404);

  const { count, error: countErr } = await supabase
    .from("event_attendees")
    .select("id", { count: "exact", head: true })
    .eq("registration_id", registrationId)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  if (countErr) {
    console.error("[door-add-guest] count failed", { registrationId, err: countErr });
    return bad("Service temporarily unavailable", 503);
  }
  if ((count ?? 0) >= ((reg.quantity as number) ?? 0)) {
    return bad("This party is full — please see the welcome desk", 409);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("event_attendees")
    .insert({
      event_id: eventId,
      registration_id: registrationId,
      name,
      is_lead: false,
      slot_status: "claimed",
      checked_in_at: new Date().toISOString(),
    })
    .select("id")
    .limit(1);
  if (insErr || !inserted || inserted.length === 0) {
    console.error("[door-add-guest] insert failed", { registrationId, err: insErr });
    return bad("Could not add the guest", 500);
  }

  return NextResponse.json({ ok: true, name });
}
