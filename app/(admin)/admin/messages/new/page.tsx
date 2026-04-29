import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import BroadcastComposer from "@/components/admin/BroadcastComposer";

export default async function NewBroadcastPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/admin/login");

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("email", user.email)
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") redirect("/admin/dashboard");

  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-marine">
            New broadcast
          </h1>
          <p className="text-sm font-body text-muted-foreground mt-1">
            Compose a message to a member segment. Sender:{" "}
            <strong>juliette@genevapolo.com</strong>.
          </p>
        </div>
        <Link
          href="/admin/messages"
          className="text-sm font-body text-muted-foreground hover:text-marine"
        >
          ← Back to broadcasts
        </Link>
      </div>

      <BroadcastComposer tiers={tiers ?? []} />
    </div>
  );
}
