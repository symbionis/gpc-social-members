import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateReminderSchedule,
  type ReminderEntry,
} from "@/lib/events/reminder-schedule";

// Admin endpoint for per-event settings: the strict_checkin toggle, the ticket
// cap (events.seat_cap), and the extra reminder schedule. All fields are
// optional — callers PATCH whichever they're changing. assertAdmin mirrors the
// attendees route.
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

  let body: {
    strict_checkin?: unknown;
    seat_cap?: unknown;
    reminder_schedule?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: {
    strict_checkin?: boolean;
    seat_cap?: number | null;
    reminder_schedule?: ReminderEntry[];
  } = {};

  if ("strict_checkin" in body) {
    if (typeof body.strict_checkin !== "boolean") {
      return NextResponse.json(
        { error: "strict_checkin must be a boolean" },
        { status: 400 }
      );
    }
    updates.strict_checkin = body.strict_checkin;
  }

  if ("seat_cap" in body) {
    const raw = body.seat_cap;
    if (raw === null || raw === "") {
      updates.seat_cap = null;
    } else {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json(
          { error: "Ticket cap must be a positive integer, or blank for unlimited" },
          { status: 400 }
        );
      }
      updates.seat_cap = parsed;
    }
  }

  if ("reminder_schedule" in body) {
    const result = validateReminderSchedule(body.reminder_schedule);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    updates.reminder_schedule = result.value ?? [];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid settings to update" },
      { status: 400 }
    );
  }

  const { error } = await adminClient
    .from("events")
    .update(updates)
    .eq("id", eventId);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
