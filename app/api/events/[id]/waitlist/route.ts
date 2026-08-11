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

  let body: { name?: unknown; email?: unknown; ticket_type_id?: unknown; quantity?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const ticketTypeId =
    typeof body.ticket_type_id === "string" ? body.ticket_type_id : "";
  // One ticket per person (R6). A waitlist request for several seats carries no name or
  // email for the extra people, so redeeming it would mint unnamed tickets — the exact
  // thing every other purchase path was changed to prevent. An absent quantity means 1;
  // anything else is a stale client, and is refused rather than silently reduced.
  const quantity =
    body.quantity === undefined || body.quantity === null
      ? 1
      : typeof body.quantity === "number"
        ? body.quantity
        : Number.parseInt(String(body.quantity), 10);

  if (!name) return bad("name is required");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");
  if (!ticketTypeId) return bad("Please choose a ticket type");
  if (quantity !== 1) {
    return bad("The waitlist is one ticket per person — please refresh and try again.");
  }

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
      const { data: memberRow, error: memberErr } = await supabase
        .from("members")
        .select("id")
        .eq("auth_user_id", authUser.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (memberErr) {
        console.error("[event-waitlist] member lookup failed", memberErr);
        return bad("Could not verify membership", 500);
      }
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
    console.error("[event-waitlist] seat usage lookup failed", { eventId, err });
    return bad("Could not verify availability", 500);
  }

  const { isFullyBooked } = deriveSeatState({
    seatCap: event.seat_cap,
    seatsUsed,
  });

  if (!isFullyBooked) {
    return bad("Event still has availability");
  }

  // Validate the chosen ticket type belongs to this event, is active, and consumes a
  // seat. The seat check is the point of the waitlist: a type that takes no seat can
  // never be offered one (deriveWaitlistOfferability rejects it), so accepting the
  // signup would queue someone behind a seat that will never be freed for them, and
  // leave an entry an admin can only ever repair or delete.
  const { data: ticketType, error: ticketTypeErr } = await supabase
    .from("event_ticket_types")
    .select("id")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .is("archived_at", null)
    .eq("counts_as_seat", true)
    .maybeSingle();
  if (ticketTypeErr) {
    // Not the same as "no such type": telling someone their ticket type is unavailable when
    // the lookup simply failed sends them to refresh, see it still offered, and give up —
    // with nothing logged anywhere. Match the two guards below and fail loudly.
    console.error("[event-waitlist] ticket type lookup failed", { eventId, ticketTypeId, err: ticketTypeErr });
    return bad("Could not verify availability", 500);
  }
  if (!ticketType) {
    return bad("That ticket type is no longer available — please refresh and try again.");
  }

  // Already holding a seat? Then there is nothing to queue for. The register route's
  // duplicate-email guard would reject the redemption anyway (R12), so the entry could
  // only ever sit in the admin waitlist unofferable, with no repair that helps.
  //
  // This does not make that state unreachable — someone can join the waitlist and buy a
  // seat afterwards — but it removes the case the club will actually hit.
  const { data: liveReg, error: liveRegErr } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .eq("email", email)
    .in("status", ["paid", "free"])
    .limit(1);
  if (liveRegErr) {
    // Fail closed: proceeding would create exactly the unofferable entry this check exists
    // to prevent, and nothing downstream would flag it as an error rather than a signup.
    console.error("[event-waitlist] registration lookup failed", { eventId, err: liveRegErr });
    return bad("Could not verify availability", 500);
  }
  if (liveReg && liveReg.length > 0) {
    return bad("You already have a registration for this event");
  }

  // One entry per email per event. A second entry cannot be offered anything the first
  // cannot, and two rows for one person is exactly the clutter an admin then has to
  // reconcile by hand. The unique index on (event_id, lower(trim(email))) is the race-safe
  // backstop; this is the readable error.
  const { data: existingEntry, error: existingErr } = await supabase
    .from("event_waitlist")
    .select("id")
    .eq("event_id", eventId)
    .eq("email", email)
    .limit(1);
  if (existingErr) {
    console.error("[event-waitlist] duplicate lookup failed", { eventId, err: existingErr });
    return bad("Could not verify availability", 500);
  }
  if (existingEntry && existingEntry.length > 0) {
    return bad("You are already on the waitlist for this event");
  }

  const { error: insertErr } = await supabase
    .from("event_waitlist")
    .insert({
      event_id: eventId,
      name,
      email,
      ticket_type_id: ticketTypeId,
      quantity,
    });

  if (insertErr) {
    // 23505 = the unique index caught a concurrent duplicate the check above raced past.
    if ((insertErr as { code?: string }).code === "23505") {
      return bad("You are already on the waitlist for this event");
    }
    console.error("[event-waitlist] insert failed", {
      eventId,
      email,
      err: insertErr,
    });
    return bad("Could not join waitlist", 500);
  }

  return NextResponse.json({ success: true });
}
