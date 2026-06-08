import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTicketType } from "@/lib/events/ticket-types";

// Per-ticket-type writer (update one, archive-or-delete one). Every mutation is
// scoped to BOTH the path event id and the ticket type id, so an admin with
// access to event A cannot modify event B's type by supplying B's id under A's
// path (IDOR guard): a mismatch returns 404.
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

  if (
    !admins?.[0] ||
    !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)
  ) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ticketTypeId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, ticketTypeId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Event-scoped existence check (IDOR guard). Load the current values too: this is
  // a PATCH, so any field the caller omits must keep its stored value rather than be
  // reset to normalizeTicketType's default. (Without this, saving only the guest
  // price — as the Settings tab does — silently cleared is_child / counts_as_seat,
  // un-flagging children's tickets so check-in stopped offering the party's kids.)
  const { data: existing } = await adminClient
    .from("event_ticket_types")
    .select("title, price_member, price_non_member, invite_price, counts_as_seat, is_child")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
  }

  const { data: event } = await adminClient
    .from("events")
    .select("visibility")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Merge the caller's fields over the stored row before validating, so an omitted
  // field is preserved instead of defaulted away.
  const patch = typeof body === "object" && body !== null ? body : {};
  const result = normalizeTicketType({ ...existing, ...patch }, event.visibility);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { data: updated, error } = await adminClient
    .from("event_ticket_types")
    .update(result.value)
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .select("*")
    .single();

  if (error || !updated) {
    console.error("[ticket-types] update failed", { eventId, ticketTypeId, error });
    return NextResponse.json({ error: "Could not update ticket type" }, { status: 500 });
  }
  return NextResponse.json({ ticket_type: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; ticketTypeId: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId, ticketTypeId } = await params;

  // Event-scoped existence check (IDOR guard).
  const { data: existing } = await adminClient
    .from("event_ticket_types")
    .select("id, archived_at")
    .eq("id", ticketTypeId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
  }

  // Refuse to remove the event's last active type — every event keeps >=1.
  if (!existing.archived_at) {
    const { count } = await adminClient
      .from("event_ticket_types")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .is("archived_at", null);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "An event must keep at least one ticket type" },
        { status: 400 }
      );
    }
  }

  // A type referenced by a registration line item OR a waitlist entry is
  // archived (kept for history / immutable audit), never hard-deleted: the
  // registration_items FK is RESTRICT, and waitlist.ticket_type_id is SET NULL
  // (a hard delete would orphan it).
  const [{ count: itemRefs }, { count: waitlistRefs }] = await Promise.all([
    adminClient
      .from("event_registration_items")
      .select("id", { count: "exact", head: true })
      .eq("ticket_type_id", ticketTypeId),
    adminClient
      .from("event_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("ticket_type_id", ticketTypeId),
  ]);

  if ((itemRefs ?? 0) > 0 || (waitlistRefs ?? 0) > 0) {
    const { error } = await adminClient
      .from("event_ticket_types")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", ticketTypeId)
      .eq("event_id", eventId);
    if (error) {
      console.error("[ticket-types] archive failed", { eventId, ticketTypeId, error });
      return NextResponse.json({ error: "Could not archive ticket type" }, { status: 500 });
    }
    return NextResponse.json({ archived: true });
  }

  const { error } = await adminClient
    .from("event_ticket_types")
    .delete()
    .eq("id", ticketTypeId)
    .eq("event_id", eventId);
  if (error) {
    console.error("[ticket-types] delete failed", { eventId, ticketTypeId, error });
    return NextResponse.json({ error: "Could not delete ticket type" }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
