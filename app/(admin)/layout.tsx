import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AdminSidebar from "@/components/admin/AdminSidebar";

const EVENTS_ADMIN_ALLOWED_PREFIXES = ["/admin/events", "/admin/lounge"];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    // Not an admin — sign out and redirect
    await supabase.auth.signOut();
    redirect("/admin/login?error=unauthorized");
  }

  if (adminUser.role === "events_admin") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const allowed = EVENTS_ADMIN_ALLOWED_PREFIXES.some((p) =>
      pathname === p || pathname.startsWith(`${p}/`)
    );
    if (!allowed) {
      redirect("/admin/events");
    }
  }

  return (
    <div className="min-h-screen bg-cream flex">
      <AdminSidebar admin={adminUser} />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
