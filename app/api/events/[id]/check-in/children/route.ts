import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkInChildren } from "@/lib/events/checkin";

// Public, unauthenticated: mark the selected children as arrived. Reached from the
// kiosk after an adult checks in ("checking in with me") and from the door console as
// a staff fallback. Children are contactless and waiver-exempt, so this only stamps
// the arrival; checkInChildren scopes strictly to is_child rows in this event that
// aren't already checked in, so a stray id is silently ignored.

const MAX_IDS = 50;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: { attendeeIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  if (!Array.isArray(body.attendeeIds)) return bad("attendeeIds must be provided");
  const ids = body.attendeeIds.filter(
    (v): v is string => typeof v === "string" && UUID_RE.test(v)
  );
  if (ids.length === 0) return bad("no valid attendeeIds");
  if (ids.length > MAX_IDS) return bad("too many attendees");

  // Confirm the event exists + is published before any write.
  const supabase = createAdminClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (eventError) {
    console.error("[event-checkin-children] event lookup failed", { eventId, err: eventError });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event || !event.is_published) return bad("Event not found", 404);

  try {
    const checkedIn = await checkInChildren(eventId, ids);
    return NextResponse.json({ ok: true, checkedIn });
  } catch (err) {
    console.error("[event-checkin-children] check-in failed", { eventId, err });
    return bad("Could not check in the children", 500);
  }
}
