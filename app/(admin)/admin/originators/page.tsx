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

  // Get originators — super_admin sees all, team_admin sees only self
  let originatorQuery = supabase
    .from("admin_users")
    .select("id, first_name, last_name, email, invite_code")
    .eq("is_originator", true);

  if (currentAdmin?.role !== "super_admin") {
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Originators
      </h1>
      <OriginatorList
        originators={originators || []}
        referrals={referrals || []}
        appUrl={appUrl}
      />
    </div>
  );
}
