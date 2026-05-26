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
  let str = String(value);
  // Formula-injection guard: name / inviter_name come from the unauthenticated
  // public check-in endpoint. A leading =, +, -, @ (or tab/CR) makes spreadsheet
  // apps execute the cell as a formula, so neutralize it with a leading quote.
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

  const { data: rows } = await adminClient
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, created_at"
    )
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });

  // Per-registration line items → "2× Standard, 2× Kids" breakdown column.
  const regIds = (rows || []).map((r) => r.id);
  const { data: items } = regIds.length
    ? await adminClient
        .from("event_registration_items")
        .select("registration_id, title_snapshot, quantity, created_at")
        .in("registration_id", regIds)
        .order("created_at", { ascending: true })
    : { data: [] as { registration_id: string; title_snapshot: string; quantity: number }[] };
  const breakdownByReg = new Map<string, string>();
  for (const it of items || []) {
    const line = `${it.quantity}× ${it.title_snapshot}`;
    const prev = breakdownByReg.get(it.registration_id);
    breakdownByReg.set(it.registration_id, prev ? `${prev}, ${line}` : line);
  }

  // Arrival is sourced from event_checkins (single source of truth). Rows with a
  // registration_id mark a registrant as arrived; rows without one are walk-up
  // members and invited guests, appended below the registrations.
  const { data: checkins } = await adminClient
    .from("event_checkins")
    .select("registration_id, name, email, kind, inviter_name, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  const arrivalByReg = new Map<string, string>();
  for (const c of checkins || []) {
    if (c.registration_id) arrivalByReg.set(c.registration_id, c.created_at);
  }

  const headers = [
    "name",
    "email",
    "type",
    "is_member",
    "quantity",
    "ticket_types",
    "amount_chf",
    "status",
    "reference_code",
    "registered_at",
    "invited_by",
    "arrived",
    "arrived_at",
  ];

  const lines: string[] = [headers.join(",")];

  for (const r of rows || []) {
    const arrivedAt = arrivalByReg.get(r.id);
    lines.push(
      [
        csvEscape(r.name),
        csvEscape(r.email),
        "registration",
        r.is_member ? "yes" : "no",
        r.quantity,
        csvEscape(breakdownByReg.get(r.id) ?? `${r.quantity}× —`),
        Number(r.total_amount_chf).toFixed(2),
        r.status,
        r.reference_code,
        r.created_at,
        "",
        arrivedAt ? "yes" : "no",
        arrivedAt ?? "",
      ].join(",")
    );
  }

  for (const c of (checkins || []).filter((row) => !row.registration_id)) {
    lines.push(
      [
        csvEscape(c.name),
        csvEscape(c.email),
        c.kind,
        c.kind === "member" ? "yes" : "no",
        "",
        "",
        "",
        "",
        "",
        "",
        csvEscape(c.inviter_name),
        "yes",
        c.created_at,
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
