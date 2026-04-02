import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

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
    !["super_admin", "team_admin"].includes(admins[0].role)
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
  } = await request.json();

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
  });

  if (error) {
    return NextResponse.json({ error: "Create failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
