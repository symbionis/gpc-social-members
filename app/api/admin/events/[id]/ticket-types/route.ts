import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTicketType } from "@/lib/events/ticket-types";

// Single writer of event_ticket_types rows and their price columns
// (price_member, price_non_member, invite_price), per single-writer ownership.
// The event create/update routes, the agent route, and the invite-code route
// must never write these columns.
//
//   GET   → list this event's ticket types (active + archived), ordered.
//   POST  → create a new ticket type, appended after the current last.
//   PATCH → reorder (body { order: ticketTypeId[] }) — sets sort_order.
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  const { data, error } = await adminClient
    .from("event_ticket_types")
    .select("*")
    .eq("event_id", eventId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[ticket-types] list failed", { eventId, error });
    return NextResponse.json({ error: "Could not load ticket types" }, { status: 500 });
  }
  return NextResponse.json({ ticket_types: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resolve visibility to apply the per-type null rules.
  const { data: event, error: evErr } = await adminClient
    .from("events")
    .select("visibility")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const result = normalizeTicketType(body, event.visibility);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Append after the current highest sort_order for this event.
  const { data: last } = await adminClient
    .from("event_ticket_types")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (last?.sort_order ?? -1) + 1;

  const { data: inserted, error } = await adminClient
    .from("event_ticket_types")
    .insert({ event_id: eventId, ...result.value, sort_order: nextSort })
    .select("*")
    .single();

  if (error || !inserted) {
    console.error("[ticket-types] create failed", { eventId, error });
    return NextResponse.json({ error: "Could not create ticket type" }, { status: 500 });
  }
  return NextResponse.json({ ticket_type: inserted });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;
  const { id: eventId } = await params;

  let body: { order?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const order = body.order;
  if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "order must be an array of ticket type ids" }, { status: 400 });
  }

  // Apply sort_order by position, scoping every update to this event so a
  // foreign id silently no-ops rather than touching another event's types.
  for (let i = 0; i < order.length; i++) {
    const { error } = await adminClient
      .from("event_ticket_types")
      .update({ sort_order: i })
      .eq("id", order[i] as string)
      .eq("event_id", eventId);
    if (error) {
      console.error("[ticket-types] reorder failed", { eventId, error });
      return NextResponse.json({ error: "Could not reorder ticket types" }, { status: 500 });
    }
  }
  return NextResponse.json({ success: true });
}
