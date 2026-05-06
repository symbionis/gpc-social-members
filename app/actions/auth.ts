"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

export async function sendOtpCode(email: string) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { error: "Please enter your email address." };

  const adminClient = createAdminClient();
  const [{ data: members }, { data: adminUsers }] = await Promise.all([
    adminClient.from("members").select("id").ilike("email", trimmed).limit(1),
    adminClient.from("admin_users").select("id").ilike("email", trimmed).limit(1),
  ]);

  if (!members?.length && !adminUsers?.length) {
    return {
      error: "No account found for this email. Please check the address or apply for membership.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { shouldCreateUser: true },
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function verifyOtpCode(
  email: string,
  token: string,
  portal: "member" | "admin"
) {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) return { error: "Invalid or expired code. Please try again.", redirect: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: "Authentication failed. Please try again.", redirect: null };
  }

  const adminClient = createAdminClient();

  const [{ data: members }, { data: adminUsers }] = await Promise.all([
    adminClient.from("members").select("id, auth_user_id").eq("email", user.email).limit(1),
    adminClient.from("admin_users").select("id, auth_user_id, role").eq("email", user.email).limit(1),
  ]);

  const member = members?.[0];
  const adminUser = adminUsers?.[0];

  // Link auth_user_id if needed
  if (member && !member.auth_user_id) {
    await adminClient.from("members").update({ auth_user_id: user.id }).eq("id", member.id);
  }
  if (adminUser && !adminUser.auth_user_id) {
    await adminClient.from("admin_users").update({ auth_user_id: user.id }).eq("id", adminUser.id);
  }

  // Route based on portal
  if (portal === "member") {
    if (member) return { error: null, redirect: "/dashboard" };
    if (adminUser) return { error: null, redirect: "/admin/dashboard" };
    await supabase.auth.signOut();
    return { error: "No membership found for this email.", redirect: null };
  }

  // Admin portal
  if (adminUser) {
    const dest =
      adminUser.role === "originator"
        ? "/admin/originators"
        : adminUser.role === "events_admin"
          ? "/admin/events"
          : "/admin/dashboard";
    return { error: null, redirect: dest };
  }
  if (member) return { error: null, redirect: "/dashboard" };
  await supabase.auth.signOut();
  return { error: "You do not have admin access.", redirect: null };
}

export async function sendPasswordReset(email: string, redirectTo: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function updatePassword(password: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { error: null };
}
