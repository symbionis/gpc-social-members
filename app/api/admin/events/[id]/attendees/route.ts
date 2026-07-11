import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDoorRoster, type RosterRow } from "@/lib/events/door-roster";

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

  if (!admins?.[0] || !["super_admin", "team_admin", "events_admin", "finance"].includes(admins[0].role)) {
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

const HEADERS = [
  "booking_ref",
  "last_name",
  "first_name",
  "ticket_type",
  "email",
  "phone",
  "is_member",
  "party_lead",
  "tickets",
  "waiver",
  "arrived",
];

function emit(r: RosterRow): string {
  return [
    r.bookingRef,
    r.last,
    r.first,
    r.ticketType,
    r.email,
    r.phone,
    r.isMember,
    r.partyLead,
    r.tickets,
    r.waiver,
    r.arrived,
  ]
    .map(csvEscape)
    .join(",");
}

// The spreadsheet view of the door roster. The printed view of the same rows lives at
// app/(print)/print/door-roster/[id]; both read lib/events/door-roster, so the sheet on
// paper and the sheet in Excel can never list different people in a different order.
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

  const roster = await buildDoorRoster(adminClient, eventId);

  if (roster.status === "not_found") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  // A failed load must never be exported as an empty/zeroed sheet — that would put a
  // confident-but-wrong roster in front of door staff. Fail loud.
  if (roster.status === "error") {
    return NextResponse.json(
      { error: "Could not load attendees for export" },
      { status: 500 }
    );
  }

  const { event, parties } = roster;
  const csv = [HEADERS.join(","), ...parties.flatMap((p) => p.rows.map(emit))].join("\n");

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
