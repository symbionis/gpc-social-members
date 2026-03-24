import { createAdminClient } from "@/lib/supabase/admin";
import MemberList from "@/components/admin/MemberList";

export default async function MembersPage() {
  const supabase = createAdminClient();

  const { data: members } = await supabase
    .from("members")
    .select(
      "id, first_name, last_name, email, member_number, tier_id, status, payment_status, originator_id, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name");

  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name")
    .eq("is_originator", true);

  const tierMap = Object.fromEntries(
    (tiers || []).map((t: Record<string, unknown>) => [t.id, t.name])
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
        Members
      </h1>
      <MemberList
        members={members || []}
        tierMap={tierMap}
        originatorMap={originatorMap}
      />
    </div>
  );
}
