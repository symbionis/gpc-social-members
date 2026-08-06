import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import OriginatorList from "@/components/admin/OriginatorList";
import { zurichMonthKey } from "@/lib/members/payments";

export default async function OriginatorsPage() {
  const supabase = createAdminClient();
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();

  // Get current admin
  const { data: admins } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("email", user?.email || "")
    .limit(1);
  const currentAdmin = admins?.[0];
  const isSuperAdmin = currentAdmin?.role === "super_admin";
  // The finance role is a reporting role: it sees the full originator list (to
  // match the finance dashboard's originator revenue breakdown) but cannot add
  // or manage originators (that stays super_admin-only, below and in the route).
  const canSeeAllOriginators = isSuperAdmin || currentAdmin?.role === "finance";

  // Get originators — super_admin/finance see all, others see only self
  let originatorQuery = supabase
    .from("admin_users")
    .select("id, first_name, last_name, email, invite_code, invite_link_active")
    .eq("is_originator", true);

  if (!canSeeAllOriginators) {
    originatorQuery = originatorQuery.eq("id", currentAdmin?.id || "");
  }

  const { data: originators } = await originatorQuery;

  // Get referred members per originator. `created_at` and `tier_id` drive the
  // month grouping on each card.
  const { data: referrals } = await supabase
    .from("members")
    .select("id, first_name, last_name, status, originator_id, created_at, tier_id")
    .in(
      "originator_id",
      (originators || []).map((o: Record<string, unknown>) => o.id)
    );

  const { data: tiers } = await supabase.from("membership_tiers").select("id, name");
  const tierNameById = new Map(
    (tiers || []).map((t: { id: string; name: string }) => [t.id, t.name]),
  );

  // Bucket into Geneva calendar months HERE, in the server component. The month
  // key needs Intl, and lib/format exists precisely because Node and Safari ICU
  // disagree on formatter output, which surfaces as invisible hydration
  // mismatches. Resolving the key server-side keeps that off the client, and the
  // list component only ever compares plain "YYYY-MM" strings.
  const referralRows = (referrals || []).map(
    (r: {
      id: string;
      first_name: string;
      last_name: string;
      status: string;
      originator_id: string;
      created_at: string;
      tier_id: string | null;
    }) => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      status: r.status,
      originator_id: r.originator_id,
      joinedAt: r.created_at,
      monthKey: zurichMonthKey(r.created_at),
      tierName: r.tier_id ? tierNameById.get(r.tier_id) ?? "Unknown tier" : null,
    }),
  );

  // Get admin users who are NOT already originators (for the add dropdown)
  let availableAdmins: { id: string; first_name: string; last_name: string; email: string }[] = [];
  if (isSuperAdmin) {
    const { data } = await supabase
      .from("admin_users")
      .select("id, first_name, last_name, email")
      .eq("is_originator", false)
      .order("first_name", { ascending: true });
    availableAdmins = data || [];
  }

  // Fetch honorary invite code setting
  const { data: honorarySettings } = await supabase
    .from("email_settings")
    .select("value")
    .eq("key", "honorary_invite_code")
    .limit(1);

  const honoraryCode = (honorarySettings?.[0]?.value as { code?: string })?.code || "";

  const appUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Originators
      </h1>
      <OriginatorList
        originators={originators || []}
        referrals={referralRows}
        appUrl={appUrl}
        isSuperAdmin={isSuperAdmin}
        availableAdmins={availableAdmins}
        honoraryCode={honoraryCode}
      />
    </div>
  );
}
