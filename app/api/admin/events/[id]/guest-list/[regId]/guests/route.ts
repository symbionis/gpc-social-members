import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import {
  parseGuestsInput,
  suppliedTicketTypeIds,
  mapCompRpcError,
  mentionsTicketType,
  unresolvedTicketTypeIds,
} from "@/lib/events/guest-list";

// Admin actions on an EXISTING comp guest list: add guests (POST) and remove one
// (DELETE). A comp list has no quantity ceiling (R6) — each addition mints a ticket and
// each removal returns the seat.
//
// See docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md (U2).
//
// No seat-cap gate (KTD6 / R11); `seats_used` is returned for display only. Nothing is
// emailed (R8). Only handlers may be exported from this file — helpers live in
// lib/events/guest-list.ts.

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

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
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, regId } = await params;

  let body: { idempotencyKey?: unknown; guests?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  // The replay guard (KTD2). A FOR UPDATE lock serializes two identical submits; it does
  // not dedupe them, and a client-side submitting flag survives neither a network retry
  // nor a proxy retry nor a back-and-resubmit. The key is the client's, generated once
  // per submit and reused across retries, so a replay adds nothing.
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey) return bad("idempotencyKey is required");

  const guests = parseGuestsInput(body.guests);
  if (!guests.ok) return bad(guests.error);
  if (guests.value.length === 0) return bad("At least one guest is required");

  // Line items + quantity bump + mint + name, under the registration lock. The RPC
  // refuses a registration that is not a comp guest list, and resolves every
  // ticket_type_id against the registration's event.
  const { data: added, error: rpcErr } = await adminClient.rpc("add_comp_guests", {
    p_registration_id: regId,
    p_idempotency_key: idempotencyKey,
    p_guests: guests.value,
  });

  if (rpcErr) {
    const mapped = mapCompRpcError(rpcErr, "Could not add the guests");

    if (mapped.status === 400 && mentionsTicketType(mapped.message)) {
      const offending = await unresolvedTicketTypeIds(
        adminClient,
        eventId,
        suppliedTicketTypeIds(null, guests.value)
      );
      if (offending.length > 0) {
        return bad(
          `Unknown or archived ticket type for this event: ${offending.join(", ")}`,
          400
        );
      }
    }

    if (mapped.status === 500) {
      console.error("[guest-list] add failed", { eventId, regId, err: rpcErr });
    }
    return bad(mapped.message, mapped.status);
  }

  const seatsUsed = await seatsUsedOrNull(adminClient, eventId);

  return NextResponse.json({
    success: true,
    added: typeof added === "number" ? added : guests.value.length,
    seats_used: seatsUsed,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; regId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, regId } = await params;

  let body: { ticketId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
  if (!ticketId) return bad("ticketId is required");

  // IDOR guard, BEFORE any RPC call. remove_comp_guest scopes the ticket to the
  // registration but knows nothing of the path event, and takes the registration id on
  // trust. An unscoped ticket id would otherwise tombstone a paying attendee's ticket.
  // Both of these must hold: the registration is a comp list ON THIS EVENT, and the
  // ticket is on that registration AND that event.
  const { data: registration, error: regErr } = await adminClient
    .from("event_registrations")
    .select("id")
    .eq("id", regId)
    .eq("event_id", eventId)
    .eq("is_guest_list", true)
    .maybeSingle();

  if (regErr) {
    console.error("[guest-list] registration lookup failed", { eventId, regId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!registration) return bad("Guest list not found", 404);

  const { data: ticket, error: ticketErr } = await adminClient
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("registration_id", regId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (ticketErr) {
    console.error("[guest-list] ticket lookup failed", { eventId, regId, ticketId, err: ticketErr });
    return bad("Service temporarily unavailable", 503);
  }
  if (!ticket) return bad("Guest not found on this guest list", 404);

  const { data: result, error: rpcErr } = await adminClient.rpc("remove_comp_guest", {
    p_registration_id: regId,
    p_ticket_id: ticketId,
  });

  if (rpcErr) {
    const mapped = mapCompRpcError(rpcErr, "Could not remove the guest");
    if (mapped.status === 500) {
      console.error("[guest-list] remove failed", { eventId, regId, ticketId, err: rpcErr });
    }
    return bad(mapped.message, mapped.status);
  }

  // remove_comp_guest returns a jsonb status rather than raising, so the refusals are
  // read from the payload: the lead can never be removed, and a checked-in guest is
  // already through the door (R7).
  const status = (result as { status?: string } | null)?.status ?? "";
  if (status === "is_lead") return bad("The lead cannot be removed from their own guest list", 400);
  if (status === "checked_in") return bad("This guest has already checked in", 409);
  if (status !== "ok") return bad("Guest not found on this guest list", 404);

  const seatsUsed = await seatsUsedOrNull(adminClient, eventId);

  return NextResponse.json({ success: true, seats_used: seatsUsed });
}

// Display-only seat count taken AFTER the write. A failure here must never turn a
// successful write into an error response, so it degrades to null.
async function seatsUsedOrNull(
  adminClient: ReturnType<typeof createAdminClient>,
  eventId: string
): Promise<number | null> {
  try {
    return await getSeatsUsed(adminClient, eventId);
  } catch (err) {
    console.error("[guest-list] seat count failed (non-fatal)", { eventId, err });
    return null;
  }
}
