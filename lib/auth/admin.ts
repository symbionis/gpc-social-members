import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

// Admin gate for routes that live outside the (admin) route group (and so don't
// inherit app/(admin)/layout.tsx's check) but must still be admin-only — e.g.
// the print/flyer route. Mirrors that layout's auth: authenticated user with a
// matching admin_users row. Does NOT replicate the layout's events_admin
// path-prefix restriction, which is specific to in-group admin navigation.
//
// redirect() throws, so callers can treat a return as "authorized".
export async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/admin/login");
  }

  const adminClient = createAdminClient();
  const { data: adminUser } = await adminClient
    .from("admin_users")
    .select("*")
    .eq("email", user.email)
    .single();

  if (!adminUser) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=unauthorized");
  }

  return adminUser;
}
