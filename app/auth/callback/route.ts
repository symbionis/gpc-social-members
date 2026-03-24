import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

// Post-auth redirect: check if user is admin or member, redirect accordingly
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const adminClient = createAdminClient();

  // Check if user is an admin — link auth_user_id if not already linked
  const { data: adminUsers } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id")
    .eq("email", user.email)
    .limit(1);

  const adminUser = adminUsers?.[0];

  if (adminUser) {
    if (!adminUser.auth_user_id) {
      await adminClient
        .from("admin_users")
        .update({ auth_user_id: user.id })
        .eq("id", adminUser.id);
    }
    return NextResponse.redirect(`${origin}/admin/dashboard`);
  }

  // Check if user is a member — link auth_user_id if not already linked
  const { data: members } = await adminClient
    .from("members")
    .select("id, auth_user_id, status")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];

  if (member) {
    if (!member.auth_user_id) {
      await adminClient
        .from("members")
        .update({ auth_user_id: user.id })
        .eq("id", member.id);
    }
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // User exists in auth but not in members or admin_users
  await supabase.auth.signOut();
  return NextResponse.redirect(
    `${origin}/login?error=no_account&message=No+membership+found+for+this+email.`
  );
}
