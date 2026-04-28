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
    !["super_admin", "team_admin", "events_admin"].includes(admins[0].role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { event_id } = await request.json();

  const { error } = await adminClient
    .from("events")
    .delete()
    .eq("id", event_id);

  if (error) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
