import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";

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
    price_member,
    price_non_member,
    reminder_schedule,
  } = await request.json();

  const reminderResult = validateReminderSchedule(reminder_schedule);
  if (!reminderResult.ok) {
    return NextResponse.json({ error: reminderResult.error }, { status: 400 });
  }

  const regEnabled = Boolean(registration_enabled);
  const priceMember = price_member === "" || price_member === null || price_member === undefined
    ? null
    : Number(price_member);
  const priceNonMember = price_non_member === "" || price_non_member === null || price_non_member === undefined
    ? null
    : Number(price_non_member);

  const isMembersOnly = visibility !== "public";
  const effectivePriceNonMember = isMembersOnly ? null : priceNonMember;

  if (regEnabled) {
    if (priceMember === null || Number.isNaN(priceMember)) {
      return NextResponse.json(
        { error: "Member price is required when registration is enabled" },
        { status: 400 }
      );
    }
    if (!isMembersOnly && (effectivePriceNonMember === null || Number.isNaN(effectivePriceNonMember))) {
      return NextResponse.json(
        { error: "Non-member price is required for public events when registration is enabled" },
        { status: 400 }
      );
    }
    if (priceMember < 0 || (effectivePriceNonMember !== null && effectivePriceNonMember < 0)) {
      return NextResponse.json({ error: "Prices cannot be negative" }, { status: 400 });
    }
  }

  const imageList = Array.isArray(images)
    ? images.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  const heroImage = imageList[0] ?? image_url ?? null;
  const secondImage = imageList[1] ?? image_url_2 ?? null;

  const { error } = await adminClient.from("events").insert({
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
    price_member: priceMember,
    price_non_member: effectivePriceNonMember,
    reminder_schedule: reminderResult.value ?? [],
  });

  if (error) {
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
