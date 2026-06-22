import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";

// Free a guest's slot (U11 / door-console guest swaps). Public, keyed on the event
// id (same trust model as the door console — KTD1). Releasing a not-yet-arrived
// guest opens a slot so a replacement can self-register. Strict guards: only a
// claimed, non-lead, NOT-checked-in attendee of this event can be released, and
// releasing sets released_at rather than deleting (the identity/waiver record is
// kept). A checked-in attendee can never be removed here — arrivals are permanent.

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type AttendeeRow = {
  id: string;
  is_lead: boolean;
  checked_in_at: string | null;
  released_at: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  const event = await resolveDoorEvent(eventId);
  if (!event) return bad("Not available", 404);

  let body: { attendeeId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const attendeeId =
    typeof body.attendeeId === "string" ? body.attendeeId.trim() : "";
  if (!attendeeId) return bad("attendeeId is required");

  const supabase = createAdminClient();

  const { data: attendee, error: loadErr } = await supabase
    .from("tickets")
    .select("id, is_lead, checked_in_at, released_at")
    .eq("id", attendeeId)
    .eq("event_id", eventId)
    .eq("slot_status", "claimed")
    .limit(1)
    .maybeSingle();
  if (loadErr) {
    console.error("[door-free-slot] load failed", { eventId, attendeeId, err: loadErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!attendee) return bad("Guest not found", 404);

  const row = attendee as AttendeeRow;
  if (row.is_lead) return bad("The party lead can’t be removed", 400);
  if (row.checked_in_at) {
    return bad("This guest has already checked in and can’t be removed", 409);
  }
  // Already released → idempotent success (a double-tap from the console).
  if (row.released_at) return NextResponse.json({ ok: true, already: true });

  // Guard the flip on checked_in_at IS NULL so a concurrent door check-in can't be
  // erased by a release that raced it.
  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("tickets")
    .update({ released_at: now })
    .eq("id", attendeeId)
    .eq("event_id", eventId)
    .eq("is_lead", false)
    .is("checked_in_at", null)
    .is("released_at", null)
    .select("id");
  if (updErr) {
    console.error("[door-free-slot] update failed", { eventId, attendeeId, err: updErr });
    return bad("Could not remove the guest", 500);
  }
  if (!updated || updated.length === 0) {
    // Lost the race — the guest checked in between load and update.
    return bad("This guest has already checked in and can’t be removed", 409);
  }

  return NextResponse.json({ ok: true, already: false });
}
