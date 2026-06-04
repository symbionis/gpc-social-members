import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollupTicketItems, formatTicketBreakdown } from "@/lib/events/tickets";

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

  if (!admins?.[0] || !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Formula-injection guard: name / contact come from unauthenticated public
  // surfaces (self-registration, door). A leading =, +, -, @ (or tab/CR) makes
  // spreadsheet apps execute the cell as a formula, so neutralize it with a
  // leading quote.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient } = auth;

  const { id: eventId } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "csv") {
    return NextResponse.json({ error: "format=csv required" }, { status: 400 });
  }

  const { data: event } = await adminClient
    .from("events")
    .select("id, title, start_date")
    .eq("id", eventId)
    .single();

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // event_attendees is the per-person source of truth (event_checkins is frozen).
  // One row per claimed attendee; columns mirror the admin roster (AttendeeList).
  interface AttendeeRow {
    registration_id: string | null;
    member_id: string | null;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    is_lead: boolean;
    ticket_type_id: string | null;
    waiver_accepted_at: string | null;
    checked_in_at: string | null;
    created_at: string;
  }
  const { data: attendees } = await adminClient
    .from("event_attendees")
    .select(
      "registration_id, member_id, name, email, phone_e164, is_lead, ticket_type_id, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", eventId)
    .eq("slot_status", "claimed")
    .is("released_at", null)
    .order("created_at", { ascending: true });

  const roster = (attendees || []) as AttendeeRow[];

  // Each person's own ticket type (asado meal) → a per-person column for catering.
  const { data: typeRows } = await adminClient
    .from("event_ticket_types")
    .select("id, title")
    .eq("event_id", eventId);
  const ticketTitleById = new Map<string, string>();
  for (const t of typeRows ?? []) {
    ticketTitleById.set(t.id as string, (t.title as string | null) ?? "");
  }

  // Lead name per registration → guests are attributed to their party's lead.
  const leadNameByReg = new Map<string, string>();
  for (const a of roster) {
    if (a.is_lead && a.registration_id && a.name) {
      leadNameByReg.set(a.registration_id, a.name);
    }
  }

  // Tickets per party — the total on the registration, the breakdown on its items.
  // Attributed to the lead row only (mirrors the admin roster list).
  const { data: regRows } = await adminClient
    .from("event_registrations")
    .select("id, quantity")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  const registrationIds = (regRows ?? []).map((r) => r.id as string);

  const { data: itemRows } = registrationIds.length
    ? await adminClient
        .from("event_registration_items")
        .select("registration_id, title_snapshot, quantity")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const ticketQtyByReg = new Map<string, number>();
  for (const r of regRows ?? []) {
    ticketQtyByReg.set(r.id as string, r.quantity as number);
  }
  type ItemRow = {
    registration_id: string;
    title_snapshot: string | null;
    quantity: number | null;
  };
  const ticketItemsByReg = new Map<string, ItemRow[]>();
  for (const item of (itemRows ?? []) as ItemRow[]) {
    const list = ticketItemsByReg.get(item.registration_id) ?? [];
    list.push(item);
    ticketItemsByReg.set(item.registration_id, list);
  }

  const headers = [
    "name",
    "email",
    "phone",
    "is_member",
    "party_lead",
    "tickets",
    "ticket_types",
    "ticket_type",
    "waiver",
    "arrived",
    "arrived_at",
  ];

  const lines: string[] = [headers.join(",")];

  for (const a of roster) {
    const partyLead = a.is_lead
      ? "lead"
      : a.registration_id
      ? `guest of ${leadNameByReg.get(a.registration_id) ?? ""}`.trim()
      : "";
    // Tickets sit on the lead row only (the guests share the party's tickets).
    const ticketRegId = a.is_lead ? a.registration_id : null;
    const ticketCount = ticketRegId ? ticketQtyByReg.get(ticketRegId) ?? "" : "";
    const ticketTypes = ticketRegId
      ? formatTicketBreakdown(rollupTicketItems(ticketItemsByReg.get(ticketRegId) ?? []))
      : "";
    // This person's own ticket type (asado meal), for the per-person catering split.
    const ticketType = a.ticket_type_id
      ? ticketTitleById.get(a.ticket_type_id) ?? ""
      : "";
    lines.push(
      [
        csvEscape(a.name),
        csvEscape(a.email),
        csvEscape(a.phone_e164),
        a.member_id ? "yes" : "no",
        csvEscape(partyLead),
        csvEscape(ticketCount),
        csvEscape(ticketTypes),
        csvEscape(ticketType),
        a.waiver_accepted_at ? "signed" : "unsigned",
        a.checked_in_at ? "yes" : "no",
        a.checked_in_at ?? "",
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const slug =
    event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") ||
    event.id;
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `attendees-${slug}-${datePart}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
