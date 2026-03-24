import { createAdminClient } from "@/lib/supabase/admin";
import ApplicationQueue from "@/components/admin/ApplicationQueue";

export default async function ApplicationsPage() {
  const supabase = createAdminClient();

  const { data: applications } = await supabase
    .from("members")
    .select(
      "id, first_name, last_name, email, phone, tier_id, status, connection_note, originator_id, created_at"
    )
    .in("status", ["pending", "approved", "declined"])
    .order("created_at", { ascending: false });

  // Fetch tier names
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_cents");

  // Fetch originator names
  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name")
    .eq("is_originator", true);

  const tierMap = Object.fromEntries(
    (tiers || []).map((t: Record<string, unknown>) => [
      t.id,
      { name: t.name, price_cents: t.price_cents },
    ])
  );
  const originatorMap = Object.fromEntries(
    (originators || []).map((o: Record<string, unknown>) => [
      o.id,
      `${o.first_name} ${o.last_name}`,
    ])
  );

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Applications
      </h1>
      <ApplicationQueue
        applications={applications || []}
        tierMap={tierMap}
        originatorMap={originatorMap}
      />
    </div>
  );
}
