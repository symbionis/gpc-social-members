import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";
import { normalizeTicketType } from "@/lib/events/ticket-types";

// Creates an event AND its seeded ticket types atomically via the
// create_event_with_ticket_types RPC, so a typeless event can never exist.
// This route no longer writes the events price columns (they moved to
// event_ticket_types) — ticket-type prices are owned by the ticket-types route.
export async function POST(request: NextRequest) {
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
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  if (
    !admins?.[0] ||
    !["super_admin", "team_admin", "events_admin", "finance"].includes(admins[0].role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    title,
    event_type_id,
    start_date,
    end_date,
    start_time,
    location,
    description,
    is_confirmed,
    is_published,
    notes,
    season_id,
    image_url,
    image_url_2,
    images,
    visibility,
    registration_enabled,
    reminder_schedule,
    ticket_types,
  } = await request.json();

  const reminderResult = validateReminderSchedule(reminder_schedule);
  if (!reminderResult.ok) {
    return NextResponse.json({ error: reminderResult.error }, { status: 400 });
  }

  const regEnabled = Boolean(registration_enabled);
  const eventVisibility = visibility === "public" ? "public" : "members_only";
  const isMembersOnly = eventVisibility === "members_only";

  // Validate + normalize ticket types (visibility-aware null rules).
  if (!Array.isArray(ticket_types) || ticket_types.length === 0) {
    return NextResponse.json(
      { error: "At least one ticket type is required" },
      { status: 400 }
    );
  }
  const normalizedTypes = [];
  for (let i = 0; i < ticket_types.length; i++) {
    const r = normalizeTicketType(ticket_types[i], eventVisibility);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    // When registration is enabled, every type must carry the prices its
    // visibility requires (mirrors assertEventRegistrationPriceable).
    if (regEnabled) {
      if (r.value.price_member === null) {
        return NextResponse.json(
          { error: `"${r.value.title}" needs a member price when registration is enabled` },
          { status: 400 }
        );
      }
      if (!isMembersOnly && r.value.price_non_member === null) {
        return NextResponse.json(
          { error: `"${r.value.title}" needs a non-member price for a public event` },
          { status: 400 }
        );
      }
    }
    normalizedTypes.push({ ...r.value, sort_order: i });
  }

  const imageList = Array.isArray(images)
    ? images.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  const heroImage = imageList[0] ?? image_url ?? null;
  const secondImage = imageList[1] ?? image_url_2 ?? null;

  const eventPayload = {
    title,
    event_type_id: event_type_id || null,
    start_date,
    end_date: end_date || null,
    start_time: start_time || null,
    location: location || null,
    description: description || null,
    is_confirmed: is_confirmed ?? false,
    is_published: is_published ?? false,
    notes: notes || null,
    season_id: season_id || null,
    image_url: heroImage,
    image_url_2: secondImage,
    images: imageList,
    visibility: eventVisibility,
    registration_enabled: regEnabled,
    reminder_schedule: reminderResult.value ?? [],
  };

  const { error } = await adminClient.rpc("create_event_with_ticket_types", {
    p_event: eventPayload,
    p_types: normalizedTypes,
  });

  if (error) {
    console.error("[admin/events/create] rpc failed", error);
    return NextResponse.json(
      { error: `Create failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
