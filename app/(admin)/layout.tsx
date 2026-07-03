import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AdminSidebar from "@/components/admin/AdminSidebar";

const EVENTS_ADMIN_ALLOWED_PREFIXES = ["/admin/events", "/admin/lounge"];

// The finance role gets the finance dashboard plus read access to the
// operational sections it reports on. Navigation into anything else (users,
// scheduled jobs, email templates, messages, applications) redirects to the
// dashboard. This layout check is the authoritative page-level gate; per-route
// write permissions match team_admin within these sections.
const FINANCE_ALLOWED_PREFIXES = [
  "/admin/finance",
  "/admin/tiers",
  "/admin/events",
  "/admin/members",
  "/admin/originators",
  "/admin/lounge",
];

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

  if (adminUser.role === "finance") {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const allowed = FINANCE_ALLOWED_PREFIXES.some((p) =>
      pathname === p || pathname.startsWith(`${p}/`)
    );
    if (!allowed) {
      redirect("/admin/finance");
    }
  }

  return (
    <div className="min-h-screen bg-cream flex">
      <AdminSidebar admin={adminUser} />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
