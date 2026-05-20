import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin endpoint for per-event check-in settings. Currently the strict_checkin
// toggle; assertAdmin mirrors the shape used by the attendees route.
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

  let body: { strict_checkin?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.strict_checkin !== "boolean") {
    return NextResponse.json(
      { error: "strict_checkin must be a boolean" },
      { status: 400 }
    );
  }

  const { error } = await adminClient
    .from("events")
    .update({ strict_checkin: body.strict_checkin })
    .eq("id", eventId);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
