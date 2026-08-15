import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateReminderSchedule,
  type ReminderEntry,
} from "@/lib/events/reminder-schedule";

// Admin endpoint for per-event settings: the ticket cap (events.seat_cap), the
// extra reminder schedule, and the invite-rate limit (events.max_tickets_invite).
// All fields are optional — callers PATCH whichever they're changing. assertAdmin
// mirrors the attendees route.
//
// max_tickets_invite (R6/R7, U8): one limit, applying only to orders at the
// invite rate, counting distinct people (KD2) — not a ticket-row count. The
// column round-trips here; enforcement at checkout is U2's job. The DB CHECK
// bounds it to 1-20 — validated here too, so a violation is a clean 400
// instead of a raw constraint error surfacing from Postgres.
//
// NB: strict_checkin is intentionally NOT handled here. Check-in is strict for
// every event by default (the door is a pure gate against event_attendees); the
// per-event toggle was removed. A PATCH carrying strict_checkin is a silent
// no-op — the field is ignored, never errored on — so any stale caller still
// succeeds. The events.strict_checkin column is retained for history (no drop).
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
    seat_cap?: unknown;
    reminder_schedule?: unknown;
    max_tickets_invite?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // NB: invite_code and invite_price are deliberately absent from this
  // whitelist — they are owned by POST|PATCH /api/admin/events/[id]/invite-code
  // (single-writer). Do not add them here. strict_checkin is also absent: it is
  // ignored (no-op) rather than rejected, so a stale client PATCHing it still
  // succeeds.
  const updates: {
    seat_cap?: number | null;
    reminder_schedule?: ReminderEntry[];
    max_tickets_invite?: number | null;
  } = {};

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

  if ("max_tickets_invite" in body) {
    const raw = body.max_tickets_invite;
    if (raw === null || raw === "") {
      updates.max_tickets_invite = null;
    } else {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
        return NextResponse.json(
          {
            error:
              "Invite limit must be a whole number between 1 and 20, or blank for unlimited",
          },
          { status: 400 }
        );
      }
      updates.max_tickets_invite = parsed;
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
    // A PATCH carrying only the retired strict_checkin field is a deliberate
    // no-op (ignored, not rejected) so stale callers still succeed.
    if ("strict_checkin" in (body as Record<string, unknown>)) {
      return NextResponse.json({ success: true });
    }
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
