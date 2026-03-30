import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (admin?.role !== "super_admin") return null;
  return admin;
}

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data: settings } = await adminClient
    .from("email_settings")
    .select("*")
    .order("key");

  return NextResponse.json({ settings: settings || [] });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireSuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key, enabled, value } = await request.json();

  if (!key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: admin.id,
  };
  if (enabled !== undefined) updates.enabled = enabled;
  if (value !== undefined) updates.value = value;

  const { error } = await adminClient
    .from("email_settings")
    .update(updates)
    .eq("key", key);

  if (error) {
    console.error("Failed to update email setting:", error);
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
