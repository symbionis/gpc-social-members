import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import OriginatorList from "@/components/admin/OriginatorList";

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

  // Get referral counts per originator
  const { data: referrals } = await supabase
    .from("members")
    .select("id, first_name, last_name, status, originator_id")
    .in(
      "originator_id",
      (originators || []).map((o: Record<string, unknown>) => o.id)
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
        referrals={referrals || []}
        appUrl={appUrl}
        isSuperAdmin={isSuperAdmin}
        availableAdmins={availableAdmins}
        honoraryCode={honoraryCode}
      />
    </div>
  );
}
