import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deriveSeatState, getSeatsUsed } from "@/lib/events/seat-usage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: { name?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!name) return bad("name is required");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");

  const supabase = createAdminClient();

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, is_published, registration_enabled, visibility, seat_cap"
    )
    .eq("id", eventId)
    .limit(1)
    .single();

  if (eventErr || !event) return bad("Event not found", 404);
  if (!event.is_published) return bad("Event is not published");
  if (!event.registration_enabled) {
    return bad("Registration is not open for this event");
  }
  if (event.seat_cap === null || event.seat_cap === undefined) {
    return bad("Event has no capacity limit");
  }

  // Members-only events: waitlist follows the same gating as registration.
  if (event.visibility === "members_only") {
    const sessionClient = await createClient();
    const {
      data: { user: authUser },
    } = await sessionClient.auth.getUser();

    let isMember = false;
    if (authUser?.id) {
      const { data: memberRow } = await supabase
        .from("members")
        .select("id")
        .eq("auth_user_id", authUser.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      isMember = Boolean(memberRow);
    }

    if (!isMember) {
      return bad("This event is for members only", 403);
    }
  }

  // Defense-in-depth: only accept waitlist signups when event is actually full.
  let seatsUsed: number;
  try {
    seatsUsed = await getSeatsUsed(supabase, eventId);
  } catch (err) {
    console.error("[event-waitlist] seat usage lookup failed", err);
    return bad("Could not verify availability", 500);
  }

  const { isFullyBooked } = deriveSeatState({
    seatCap: event.seat_cap,
    seatsUsed,
  });

  if (!isFullyBooked) {
    return bad("Event still has availability");
  }

  const { error: insertErr } = await supabase
    .from("event_waitlist")
    .insert({
      event_id: eventId,
      name,
      email,
    });

  if (insertErr) {
    console.error("[event-waitlist] insert failed", insertErr);
    return bad("Could not join waitlist", 500);
  }

  return NextResponse.json({ success: true });
}
