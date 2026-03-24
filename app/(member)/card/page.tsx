import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import MembershipCard from "@/components/card/MembershipCard";

export default async function CardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, first_name, last_name, tier_id, member_number, status")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "active") {
    redirect("/dashboard");
  }

  const { data: cards } = await adminClient
    .from("membership_cards")
    .select("card_number, valid_from, valid_until")
    .eq("member_id", member.id)
    .eq("is_active", true)
    .limit(1);

  const card = cards?.[0];
  if (!card) redirect("/dashboard");

  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("name")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <MembershipCard
        memberName={`${member.first_name} ${member.last_name}`}
        memberNumber={member.member_number || ""}
        tierName={tier?.name || "Member"}
        cardNumber={card.card_number}
        validFrom={card.valid_from}
        validUntil={card.valid_until}
        verifyUrl={`${appUrl}/verify/${card.card_number}`}
      />
      <p className="mt-6 text-sm text-muted-foreground font-body text-center">
        Save this page to your home screen for quick access at the club.
      </p>
    </div>
  );
}
