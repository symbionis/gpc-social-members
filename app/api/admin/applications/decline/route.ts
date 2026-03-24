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

  // Verify admin is on approval committee
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role, is_approval_committee")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (
    !admin ||
    (admin.role !== "super_admin" && !admin.is_approval_committee)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id, notes } = await request.json();

  // Update member status
  const { error: updateError } = await adminClient
    .from("members")
    .update({ status: "declined" })
    .eq("id", member_id);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to decline" },
      { status: 500 }
    );
  }

  // Create application audit entry
  await adminClient.from("applications").insert({
    member_id,
    reviewed_by: admin.id,
    status: "declined",
    review_notes: notes || null,
  });

  return NextResponse.json({ success: true });
}
