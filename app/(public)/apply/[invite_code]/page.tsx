import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import ApplicationForm from "@/components/public/ApplicationForm";

interface ApplyPageProps {
  params: Promise<{ invite_code: string }>;
  searchParams: Promise<{ resume?: string; hono?: string }>;
}

export default async function ApplyPage({ params, searchParams }: ApplyPageProps) {
  const { invite_code } = await params;
  const { resume, hono } = await searchParams;
  const supabase = createAdminClient();

  // Validate invite code — must belong to an active originator
  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name, invite_code, invite_link_active")
    .eq("invite_code", invite_code)
    .eq("is_originator", true)
    .limit(1);

  const originator = originators?.[0];

  if (!originator || originator.invite_link_active === false) {
    return (
      <>
      <div className="h-20 bg-marine" />
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
      </>
    );
  }

  // Validate honorary param against stored code
  let isHonorary = false;
  if (hono) {
    const { data: honoSettings } = await supabase
      .from("email_settings")
      .select("value")
      .eq("key", "honorary_invite_code")
      .limit(1);

    const storedCode = (honoSettings?.[0]?.value as { code?: string })?.code || "";
    isHonorary = !!storedCode && hono.toLowerCase() === storedCode.toLowerCase();
  }

  // Fetch tiers based on honorary status
  const tierSelect = "id, name, price_eur, benefits, guest_invitations_per_season";

  const { data: allIndividualTiers } = await supabase
    .from("membership_tiers")
    .select(tierSelect)
    .eq("category", "individual")
    .eq("is_active", true)
    .order("price_eur", { ascending: true });

  // Honorary invitees see all tiers (free honorary + paid) so they can choose.
  // Non-honorary visitors never see the free honorary tier.
  // The Player tier is reserved for active polo players and never shown in the public sign-up flow.
  const filteredIndividualTiers = (isHonorary
    ? (allIndividualTiers || [])
    : (allIndividualTiers || []).filter((t) => t.price_eur > 0)
  ).filter((t) => t.name.trim().toLowerCase() !== "player");

  const { data: corporateTiers } = await supabase
    .from("membership_tiers")
    .select(tierSelect)
    .eq("category", "corporate")
    .eq("is_active", true)
    .order("price_eur", { ascending: true });

  // Validate resume param — only allow pending members with no authorized payment
  let resumeMemberId: string | null = null;
  let resumeTierId: string | null = null;
  if (resume) {
    const { data: resumeMembers } = await supabase
      .from("members")
      .select("id, status, tier_id")
      .eq("id", resume)
      .eq("status", "pending")
      .eq("originator_id", originator.id)
      .limit(1);

    if (resumeMembers?.[0]) {
      resumeMemberId = resumeMembers[0].id;
      resumeTierId = resumeMembers[0].tier_id;
    }
  }

  return (
    <>
    <div className="h-20 bg-marine" />
    <div className="min-h-[80vh] py-12 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="text-center mb-10">
          <p className="text-base font-accent uppercase tracking-widest text-sky-dark mb-2">
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
          individualTiers={filteredIndividualTiers || []}
          corporateTiers={corporateTiers || []}
          resumeMemberId={resumeMemberId}
          resumeTierId={resumeTierId}
          isHonorary={isHonorary}
          honoParam={isHonorary ? hono || "" : ""}
        />
      </div>
    </div>
    </>
  );
}
