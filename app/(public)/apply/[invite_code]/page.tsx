import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import ApplicationForm from "@/components/public/ApplicationForm";

interface ApplyPageProps {
  params: Promise<{ invite_code: string }>;
}

export default async function ApplyPage({ params }: ApplyPageProps) {
  const { invite_code } = await params;
  const supabase = createAdminClient();

  // Validate invite code — must belong to an active originator
  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name, invite_code")
    .eq("invite_code", invite_code)
    .eq("is_originator", true)
    .limit(1);

  const originator = originators?.[0];

  if (!originator) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="font-heading text-3xl font-bold text-marine mb-4">
            Invitation Not Found
          </h1>
          <p className="text-muted-foreground font-body">
            This invitation link is no longer valid. If you believe this is an
            error, please contact the person who shared it with you.
          </p>
        </div>
      </div>
    );
  }

  // Fetch individual tiers for the form
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_eur, benefits, guest_invitations_per_season")
    .eq("category", "individual")
    .eq("is_active", true)
    .order("price_eur", { ascending: true });

  return (
    <div className="min-h-[80vh] py-12 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="text-center mb-10">
          <p className="text-sm font-accent uppercase tracking-widest text-sky-dark mb-2">
            INVITATION FROM
          </p>
          <p className="font-heading text-lg text-marine mb-6">
            {originator.first_name} {originator.last_name}
          </p>
          <h1 className="font-heading text-4xl font-bold text-marine mb-3">
            Join the Geneva Polo Club
          </h1>
          <p className="text-muted-foreground font-body max-w-lg mx-auto">
            Complete your application to become a member of the Social Member
            Club. Your application will be reviewed by our membership committee.
          </p>
        </div>

        <ApplicationForm
          originatorId={originator.id}
          tiers={tiers || []}
        />
      </div>
    </div>
  );
}
