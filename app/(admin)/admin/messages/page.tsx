import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import BroadcastList, {
  type BroadcastRow,
} from "@/components/admin/BroadcastList";

export default async function MessagesPage() {
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

  const [{ data: broadcasts }, { data: tiers }] = await Promise.all([
    adminClient
      .from("broadcasts")
      .select(
        "id, subject, audience_filter, recipient_count, error_count, status, sent_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(100),
    adminClient.from("membership_tiers").select("id, name"),
  ]);

  const tierMap: Record<string, string> = {};
  for (const t of tiers ?? []) tierMap[t.id] = t.name;

  const rows: BroadcastRow[] = (broadcasts ?? []).map((b) => ({
    id: b.id,
    subject: b.subject,
    audience_filter: (b.audience_filter ?? null) as BroadcastRow["audience_filter"],
    recipient_count: b.recipient_count,
    error_count: b.error_count,
    status: b.status,
    sent_at: b.sent_at,
    created_at: b.created_at,
  }));

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-marine">
            Messages
          </h1>
          <p className="text-sm font-body text-muted-foreground mt-1">
            Broadcast communications sent to members.
          </p>
        </div>
        <Link
          href="/admin/messages/new"
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
        >
          New broadcast
        </Link>
      </div>

      <BroadcastList broadcasts={rows} tierMap={tierMap} />
    </div>
  );
}
