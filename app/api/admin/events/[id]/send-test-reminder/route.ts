import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventReminder, type ReminderSlot } from "@/lib/email/event-reminder";

const ALLOWED_SLOTS: readonly ReminderSlot[] = ["morning", "lunch", "evening"];

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role, first_name, last_name")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (
    !admin ||
    !["super_admin", "team_admin", "events_admin"].includes(admin.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: eventId } = await ctx.params;

  const body = (await request.json().catch(() => ({}))) as {
    days_before?: unknown;
    slot?: unknown;
  };

  const daysBefore = Number(body.days_before);
  if (!Number.isInteger(daysBefore) || daysBefore < 0) {
    return NextResponse.json(
      { error: "days_before must be a non-negative integer" },
      { status: 400 }
    );
  }

  if (
    typeof body.slot !== "string" ||
    !(ALLOWED_SLOTS as readonly string[]).includes(body.slot)
  ) {
    return NextResponse.json(
      { error: `slot must be one of: ${ALLOWED_SLOTS.join(", ")}` },
      { status: 400 }
    );
  }

  const slot = body.slot as ReminderSlot;

  // Find any registration on this event to seed the merge context.
  // The send module reads registration fields (quantity, reference_code, etc.)
  // — for a test send those values come from the real event's first registration
  // when one exists, otherwise we still try to send by passing a placeholder.
  const { data: registrations } = await adminClient
    .from("event_registrations")
    .select("id")
    .eq("event_id", eventId)
    .limit(1);

  const seedRegistrationId = registrations?.[0]?.id;
  if (!seedRegistrationId) {
    return NextResponse.json(
      {
        error:
          "No registrations on this event yet — register at least one (e.g. yourself) before sending a test reminder.",
      },
      { status: 400 }
    );
  }

  const adminName =
    [admin.first_name, admin.last_name].filter(Boolean).join(" ") ||
    user.email;

  const result = await sendEventReminder(
    seedRegistrationId,
    eventId,
    daysBefore,
    slot,
    { to_email: user.email, to_name: adminName }
  );

  if (!result.success) {
    return NextResponse.json(
      { error: "Send failed", detail: String(result.error ?? "unknown") },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
