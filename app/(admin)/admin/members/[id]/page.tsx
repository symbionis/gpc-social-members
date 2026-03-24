import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import MemberDetail from "@/components/admin/MemberDetail";

interface MemberDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MemberDetailPage({
  params,
}: MemberDetailPageProps) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("id", id)
    .limit(1);

  const member = members?.[0];
  if (!member) notFound();

  const [{ data: tiers }, { data: payments }, { data: card }, { data: originators }] =
    await Promise.all([
      supabase.from("membership_tiers").select("id, name, price_eur"),
      supabase
        .from("payments")
        .select("*")
        .eq("member_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("membership_cards")
        .select("*")
        .eq("member_id", id)
        .eq("is_active", true)
        .limit(1),
      supabase
        .from("admin_users")
        .select("id, first_name, last_name")
        .eq("is_originator", true),
    ]);

  const tierMap = Object.fromEntries(
    (tiers || []).map((t: Record<string, unknown>) => [
      t.id,
      { name: t.name, price_eur: t.price_eur },
    ])
  );
  const originatorMap = Object.fromEntries(
    (originators || []).map((o: Record<string, unknown>) => [
      o.id,
      `${o.first_name} ${o.last_name}`,
    ])
  );

  return (
    <MemberDetail
      member={member}
      tierMap={tierMap}
      originatorMap={originatorMap}
      payments={payments || []}
      card={card?.[0] || null}
      allTiers={tiers || []}
    />
  );
}
