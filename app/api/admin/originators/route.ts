import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

async function verifySuperAdmin(request: NextRequest) {
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

// Create a new originator
export async function POST(request: NextRequest) {
  const admin = await verifySuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
  }

  const { first_name, last_name, email, invite_code, can_invite_honorary } =
    await request.json();

  if (!first_name || !last_name || !email || !invite_code) {
    return NextResponse.json(
      { error: "first_name, last_name, email, and invite_code are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // Check if email already exists
  const { data: existing } = await adminClient
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing admin to be an originator
    const { error } = await adminClient
      .from("admin_users")
      .update({
        is_originator: true,
        invite_code,
        invite_link_active: true,
        can_invite_honorary: can_invite_honorary || false,
      })
      .eq("id", existing[0].id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, updated: true });
  }

  // Create new admin_user as originator
  const { error } = await adminClient.from("admin_users").insert({
    first_name,
    last_name,
    email,
    role: "originator",
    is_originator: true,
    is_approval_committee: false,
    invite_code,
    invite_link_active: true,
    can_invite_honorary: can_invite_honorary || false,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, created: true });
}

// Update an existing originator
export async function PATCH(request: NextRequest) {
  const admin = await verifySuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
  }

  const { id, invite_code, invite_link_active, can_invite_honorary } =
    await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (invite_code !== undefined) updates.invite_code = invite_code;
  if (invite_link_active !== undefined) updates.invite_link_active = invite_link_active;
  if (can_invite_honorary !== undefined) updates.can_invite_honorary = can_invite_honorary;

  const { error } = await adminClient
    .from("admin_users")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
