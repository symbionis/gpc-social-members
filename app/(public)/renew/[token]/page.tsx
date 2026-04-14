import { createAdminClient } from "@/lib/supabase/admin";
import RenewalForm from "./RenewalForm";

interface RenewalPageProps {
  params: Promise<{ token: string }>;
}

export default async function RenewalPage({ params }: RenewalPageProps) {
  const { token } = await params;
  const supabase = createAdminClient();

  // Validate token
  const { data: tokens } = await supabase
    .from("renewal_tokens")
    .select("id, member_id, originator_id, used, expires_at")
    .eq("token", token)
    .limit(1);

  const renewalToken = tokens?.[0];

  if (!renewalToken || renewalToken.used || new Date(renewalToken.expires_at) < new Date()) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Link Unavailable
            </h1>
            <p className="text-muted-foreground font-body">
              This renewal link has expired or has already been used. Please
              contact us if you&apos;d like to renew your membership.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Fetch member name
  const { data: members } = await supabase
    .from("members")
    .select("first_name, last_name")
    .eq("id", renewalToken.member_id)
    .limit(1);

  const member = members?.[0];
  if (!member) {
    return (
      <>
        <div className="h-20 bg-marine" />
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <h1 className="font-heading text-3xl font-bold text-marine mb-4">
              Member Not Found
            </h1>
            <p className="text-muted-foreground font-body">
              We could not locate your membership record. Please contact us.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Fetch available tiers — always exclude honorary on renewal
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_eur, benefits, guest_invitations_per_season")
    .eq("category", "individual")
    .eq("is_active", true)
    .gt("price_eur", 0)
    .order("price_eur", { ascending: true });

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="min-h-[80vh] py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-10">
            <p className="text-sm font-accent uppercase tracking-widest text-sky-dark mb-2">
              MEMBERSHIP RENEWAL
            </p>
            <h1 className="font-heading text-4xl font-bold text-marine mb-3">
              Welcome back, {member.first_name}
            </h1>
            <p className="text-muted-foreground font-body max-w-lg mx-auto">
              We&apos;d love to have you back for another season. Select your
              membership tier and proceed to payment.
            </p>
          </div>

          <RenewalForm token={token} tiers={tiers || []} />
        </div>
      </div>
    </>
  );
}
