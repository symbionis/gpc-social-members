import { createAdminClient } from "@/lib/supabase/admin";
import TierManager from "@/components/admin/TierManager";

export default async function TiersPage() {
  const supabase = createAdminClient();

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("*")
    .order("price_eur", { ascending: true });

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Membership Tiers
      </h1>
      <TierManager tiers={tiers || []} />
    </div>
  );
}
