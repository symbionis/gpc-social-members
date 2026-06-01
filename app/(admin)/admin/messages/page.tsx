import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import BroadcastList, {
  type BroadcastRow,
} from "@/components/admin/BroadcastList";
import BroadcastDraftsList, {
  type DraftRow,
} from "@/components/admin/BroadcastDraftsList";
import { resolveAudience } from "@/lib/broadcast/audience";
import type { AudienceFilter } from "@/lib/broadcast/types";

type Tab = "sent" | "drafts";

function tabFrom(value: string | string[] | undefined): Tab {
  return value === "drafts" ? "drafts" : "sent";
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
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

  const role = admins?.[0]?.role;
  if (role !== "super_admin" && role !== "team_admin") redirect("/admin/dashboard");

  const params = await searchParams;
  const activeTab = tabFrom(params.tab);

  const [{ data: sent }, { data: drafts }, { data: tiers }, { count: draftCount }] =
    await Promise.all([
      adminClient
        .from("broadcasts")
        .select(
          "id, subject, audience_filter, recipient_count, error_count, status, sent_at, created_at"
        )
        .neq("status", "draft")
        .is("event_id", null) // member history only; event sends live on the event's Messaging tab
        .order("created_at", { ascending: false })
        .limit(100),
      adminClient
        .from("broadcasts")
        .select("id, subject, audience_filter, created_at")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(100),
      adminClient.from("membership_tiers").select("id, name"),
      adminClient
        .from("broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
    ]);

  const tierMap: Record<string, string> = {};
  for (const t of tiers ?? []) tierMap[t.id] = t.name;

  const sentRows: BroadcastRow[] = (sent ?? []).map((b) => ({
    id: b.id,
    subject: b.subject,
    audience_filter: (b.audience_filter ?? null) as BroadcastRow["audience_filter"],
    recipient_count: b.recipient_count,
    error_count: b.error_count,
    status: b.status,
    sent_at: b.sent_at,
    created_at: b.created_at,
  }));

  // Resolve live recipient counts on demand. Stays accurate as the audience
  // changes; cache only if this loop becomes a bottleneck. (Drafts list is
  // capped at 100 and audience resolution is a single COUNT per filter.)
  const draftRows: DraftRow[] = await Promise.all(
    (drafts ?? []).map(async (d) => {
      const filterRaw = (d.audience_filter ?? {}) as Record<string, unknown>;
      const filter: AudienceFilter = {
        status: (filterRaw.status as AudienceFilter["status"]) ?? "active",
        tier_ids: Array.isArray(filterRaw.tier_ids)
          ? (filterRaw.tier_ids as string[])
          : typeof filterRaw.tier_id === "string"
            ? [filterRaw.tier_id as string]
            : [],
      };
      let recipientCount = 0;
      try {
        const { recipients } = await resolveAudience(filter);
        recipientCount = recipients.length;
      } catch {
        recipientCount = 0;
      }
      return {
        id: d.id,
        subject: d.subject,
        audience_filter: (d.audience_filter ??
          null) as DraftRow["audience_filter"],
        recipient_count: recipientCount,
        created_at: d.created_at,
      };
    })
  );

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

      <div className="flex items-center gap-1 border-b border-border">
        <TabLink
          active={activeTab === "sent"}
          href="/admin/messages"
          label="Sent"
          count={sentRows.length}
        />
        <TabLink
          active={activeTab === "drafts"}
          href="/admin/messages?tab=drafts"
          label="Drafts"
          count={draftCount ?? 0}
        />
      </div>

      {activeTab === "sent" ? (
        <BroadcastList broadcasts={sentRows} tierMap={tierMap} />
      ) : (
        <BroadcastDraftsList drafts={draftRows} tierMap={tierMap} />
      )}
    </div>
  );
}

function TabLink({
  active,
  href,
  label,
  count,
}: {
  active: boolean;
  href: string;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 -mb-px border-b-2 text-sm font-body font-medium transition-colors ${
        active
          ? "border-marine text-marine"
          : "border-transparent text-muted-foreground hover:text-marine"
      }`}
    >
      {label}
      <span className="ml-2 text-xs text-muted-foreground">({count})</span>
    </Link>
  );
}
