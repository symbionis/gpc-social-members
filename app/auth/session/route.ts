import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

// Post-password-login routing — checks session and redirects to correct dashboard
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

  // Check admin
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

  // Check member
  const { data: members } = await adminClient
    .from("members")
    .select("id, auth_user_id")
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

  // No account found
  await supabase.auth.signOut();
  return NextResponse.redirect(
    `${origin}/login?error=no_account&message=No+membership+found+for+this+email.`
  );
}
