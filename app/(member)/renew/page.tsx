import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import MemberRenewalForm from "./MemberRenewalForm";

export default async function MemberRenewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, first_name, last_name, status, tier_id")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member) redirect("/login");

  if (member.status === "active") redirect("/dashboard");

  // Determine member's current tier category
  let currentCategory: "individual" | "corporate" = "individual";
  if (member.tier_id) {
    const { data: currentTier } = await adminClient
      .from("membership_tiers")
      .select("category")
      .eq("id", member.tier_id)
      .limit(1);
    if (currentTier?.[0]?.category === "corporate") {
      currentCategory = "corporate";
    }
  }

  // Fetch paid tiers (always exclude honorary)
  const [{ data: individualTiers }, { data: corporateTiers }] = await Promise.all([
    adminClient
      .from("membership_tiers")
      .select("id, name, price_eur, benefits, guest_invitations_per_season")
      .eq("category", "individual")
      .eq("is_active", true)
      .gt("price_eur", 0)
      .order("price_eur", { ascending: true }),
    adminClient
      .from("membership_tiers")
      .select("id, name, price_eur, benefits, guest_invitations_per_season")
      .eq("category", "corporate")
      .eq("is_active", true)
      .gt("price_eur", 0)
      .order("price_eur", { ascending: true }),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-marine mb-2">
          Renew Your Membership
        </h1>
        <p className="text-muted-foreground font-body">
          Welcome back, {member.first_name}. Select your membership tier for
          the new season and proceed to payment.
        </p>
      </div>

      <MemberRenewalForm
        memberId={member.id}
        currentTierId={member.tier_id}
        currentCategory={currentCategory}
        individualTiers={individualTiers || []}
        corporateTiers={corporateTiers || []}
      />
    </div>
  );
}
