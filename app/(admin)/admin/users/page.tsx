import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UserManagement from "@/components/admin/UserManagement";

export default async function UsersPage() {
  const supabase = createAdminClient();
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();

  // Verify super_admin
  const { data: admins } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("email", user?.email || "")
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") {
    redirect("/admin/dashboard");
  }

  const { data: users } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name, email, role, is_originator, is_approval_committee, invite_code, can_invite_honorary")
    .order("created_at", { ascending: true });

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        User Management
      </h1>
      <UserManagement users={users || []} />
    </div>
  );
}
