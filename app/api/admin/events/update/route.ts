import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { assertEventRegistrationPriceable } from "@/lib/events/ticket-types";

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
    !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    event_id,
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
  } = await request.json();

  const regEnabled = Boolean(registration_enabled);

  // Enabling registration: every active ticket type must carry the prices its
  // visibility requires. This guard replaces the dropped event-level price
  // CHECK constraint and is the single home of that invariant for this route.
  // (EventManager syncs ticket-type edits BEFORE calling update, so the guard
  // sees the freshly-saved types.)
  if (regEnabled) {
    const priceable = await assertEventRegistrationPriceable(event_id);
    if (!priceable.ok) {
      return NextResponse.json({ error: priceable.error }, { status: 400 });
    }
  }

  // Single-writer ownership — this bulk update route MUST NOT write:
  //   seat_cap, reminder_schedule   → Manage page (Settings / Messaging)
  //   invite_code                   → invite-code route
  //   all ticket-type prices (event_ticket_types.price_member / price_non_member
  //                            / invite_price) → ticket-types route
  // Adding any of them here would let an unrelated edit (e.g. a title change)
  // silently wipe values an owning surface saved. See
  // docs/solutions/architecture-patterns/single-writer-field-ownership-across-routes.md.

  const imageList = Array.isArray(images)
    ? images.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  const heroImage = imageList[0] ?? image_url ?? null;
  const secondImage = imageList[1] ?? image_url_2 ?? null;

  const { error } = await adminClient
    .from("events")
    .update({
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
      visibility: visibility === "public" ? "public" : "members_only",
      registration_enabled: regEnabled,
    })
    .eq("id", event_id);

  if (error) {
    console.error("[admin/events/update] update failed", { event_id, error });
    return NextResponse.json(
      { error: `Update failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
