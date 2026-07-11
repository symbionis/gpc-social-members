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

  // release_ticket (U3) atomically tombstones the claimed row (released_at kept for
  // audit) AND mints a fresh 'issued' replacement so the freed slot reopens with a
  // new credential — the released guest's old QR now resolves to a released row and
  // is rejected at the console. All guards (claimed, non-lead, not-checked-in,
  // idempotent re-release, and the check-in race) live in the RPC under a row lock.
  const { data: result, error: relErr } = await supabase.rpc("release_ticket", {
    p_ticket_id: attendeeId,
    p_event_id: eventId,
  });
  if (relErr) {
    console.error("[door-free-slot] release_ticket failed", { eventId, attendeeId, err: relErr });
    return bad("Could not remove the guest", 500);
  }
  const rel = (result ?? {}) as { status?: string; already?: boolean };
  switch (rel.status) {
    case "ok":
      return NextResponse.json({ ok: true, already: Boolean(rel.already) });
    case "is_lead":
      return bad("The party lead can’t be removed", 400);
    case "checked_in":
      return bad("This guest has already checked in and can’t be removed", 409);
    // Freeing a comp seat here would reopen it as a public, self-fillable slot and
    // never give the seat back (KTD5). Removing a comp guest shrinks the party, which
    // only remove_comp_guest (the admin Guest list tab) does.
    case "is_comp":
      return bad(
        "This is a comped guest — remove them from the Guest list tab in admin",
        409
      );
    case "not_found":
    default:
      return bad("Guest not found", 404);
  }
}
