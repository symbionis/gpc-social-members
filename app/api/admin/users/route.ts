import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

async function verifySuperAdmin() {
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
    .eq("role", "super_admin")
    .limit(1);

  return admins?.[0] || null;
}

// Create admin user
export async function POST(request: NextRequest) {
  const admin = await verifySuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { first_name, last_name, email, role, is_approval_committee } =
    await request.json();

  if (!first_name || !last_name || !email || !role) {
    return NextResponse.json(
      { error: "first_name, last_name, email, and role are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 }
    );
  }

  const { error } = await adminClient.from("admin_users").insert({
    first_name,
    last_name,
    email,
    role,
    is_approval_committee: is_approval_committee || false,
    is_originator: role === "originator",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// Update admin user
export async function PATCH(request: NextRequest) {
  const admin = await verifySuperAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, role, is_approval_committee } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (role !== undefined) updates.role = role;
  if (is_approval_committee !== undefined)
    updates.is_approval_committee = is_approval_committee;

  const { error } = await adminClient
    .from("admin_users")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
