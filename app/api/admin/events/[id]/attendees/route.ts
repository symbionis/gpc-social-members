import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const str = String(value);
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
    return NextResponse.json(
      { error: "format=csv required" },
      { status: 400 }
    );
  }

  const { data: event } = await adminClient
    .from("events")
    .select("id, title, start_date")
    .eq("id", eventId)
    .single();

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { data: rows } = await adminClient
    .from("event_registrations")
    .select(
      "name, email, is_member, quantity, total_amount_chf, status, reference_code, created_at, checked_in_at"
    )
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });

  const headers = [
    "name",
    "email",
    "is_member",
    "quantity",
    "amount_chf",
    "status",
    "reference_code",
    "registered_at",
    "checked_in_at",
  ];

  const lines: string[] = [headers.join(",")];
  for (const r of rows || []) {
    lines.push(
      [
        csvEscape(r.name),
        csvEscape(r.email),
        r.is_member ? "yes" : "no",
        r.quantity,
        Number(r.total_amount_chf).toFixed(2),
        r.status,
        r.reference_code,
        r.created_at,
        r.checked_in_at ?? "",
      ].join(",")
    );
  }

  const csv = lines.join("\n");
  const slug =
    event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      || event.id;
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
  const url = new URL(request.url);
  const registrationId = url.searchParams.get("registration_id");
  const checkedInParam = url.searchParams.get("checked_in");

  if (!registrationId || (checkedInParam !== "true" && checkedInParam !== "false")) {
    return NextResponse.json(
      { error: "registration_id and checked_in=true|false required" },
      { status: 400 }
    );
  }

  const checkedIn = checkedInParam === "true";

  const { error } = await adminClient
    .from("event_registrations")
    .update({ checked_in_at: checkedIn ? new Date().toISOString() : null })
    .eq("id", registrationId)
    .eq("event_id", eventId);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
