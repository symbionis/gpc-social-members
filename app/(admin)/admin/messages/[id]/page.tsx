import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import BroadcastDetail, {
  type BroadcastDetailRow,
  type RecipientRow,
} from "@/components/admin/BroadcastDetail";

export default async function BroadcastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const { data: broadcast } = await adminClient
    .from("broadcasts")
    .select(
      "id, subject, body_html, audience_filter, channel, status, sent_at, recipient_count, error_count, created_at"
    )
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (!broadcast) notFound();

  const [{ data: recipients }, { data: tiers }] = await Promise.all([
    adminClient
      .from("broadcast_recipients")
      .select(
        "id, email, status, error, provider_message_id, created_at, member_id"
      )
      .eq("broadcast_id", id)
      .order("created_at", { ascending: true }),
    adminClient.from("membership_tiers").select("id, name"),
  ]);

  // Resolve member display names in one query.
  const memberIds = (recipients ?? [])
    .map((r) => r.member_id)
    .filter((x): x is string => Boolean(x));
  const memberNameMap: Record<string, string> = {};
  if (memberIds.length > 0) {
    const { data: members } = await adminClient
      .from("members")
      .select("id, first_name, last_name")
      .in("id", memberIds);
    for (const m of members ?? []) {
      memberNameMap[m.id] = `${m.first_name} ${m.last_name}`;
    }
  }

  const tierMap: Record<string, string> = {};
  for (const t of tiers ?? []) tierMap[t.id] = t.name;

  const detail: BroadcastDetailRow = {
    id: broadcast.id,
    subject: broadcast.subject,
    body_html: broadcast.body_html,
    audience_filter: (broadcast.audience_filter ??
      null) as BroadcastDetailRow["audience_filter"],
    channel: broadcast.channel,
    status: broadcast.status,
    sent_at: broadcast.sent_at,
    recipient_count: broadcast.recipient_count,
    error_count: broadcast.error_count,
    created_at: broadcast.created_at,
  };

  const recipientRows: RecipientRow[] = (recipients ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    error: r.error,
    provider_message_id: r.provider_message_id,
    created_at: r.created_at,
    member_name: r.member_id ? (memberNameMap[r.member_id] ?? null) : null,
  }));

  return (
    <div className="max-w-5xl">
      <BroadcastDetail
        broadcast={detail}
        recipients={recipientRows}
        tierMap={tierMap}
      />
    </div>
  );
}
