import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function MemberDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select(
      "id, first_name, last_name, status, tier_id, member_number"
    )
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member) redirect("/login");

  // Get tier info
  const { data: tiers } = await adminClient
    .from("membership_tiers")
    .select("id, name, benefits, guest_invitations_per_season")
    .eq("id", member.tier_id)
    .limit(1);

  const tier = tiers?.[0];

  // Get active card
  const { data: cards } = await adminClient
    .from("membership_cards")
    .select("card_number, valid_from, valid_until")
    .eq("member_id", member.id)
    .eq("is_active", true)
    .limit(1);

  const card = cards?.[0];

  // Get current season
  const { data: seasons } = await adminClient
    .from("seasons")
    .select("year, start_date, end_date")
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .order("start_date", { ascending: true })
    .limit(1);

  const season = seasons?.[0];

  const statusLabels: Record<string, { label: string; color: string }> = {
    active: { label: "Active Member", color: "bg-green-100 text-green-800" },
    approved: {
      label: "Approved — Awaiting Payment",
      color: "bg-sky/20 text-sky-dark",
    },
    pending: {
      label: "Application Under Review",
      color: "bg-amber-100 text-amber-800",
    },
    expired: { label: "Membership Expired", color: "bg-gray-100 text-gray-600" },
  };

  const statusInfo = statusLabels[member.status] || {
    label: member.status,
    color: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-2">
        Welcome, {member.first_name}
      </h1>
      <p className="text-muted-foreground font-body mb-8">
        Geneva Polo Social Members Club
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Status Card */}
        <div className="bg-white rounded-xl border border-border p-6">
          <p className="text-sm font-body text-muted-foreground mb-2">
            Membership Status
          </p>
          <span
            className={`inline-block px-3 py-1 rounded-full text-sm font-body font-medium ${statusInfo.color}`}
          >
            {statusInfo.label}
          </span>
          {tier && (
            <div className="mt-4">
              <p className="text-sm font-body text-muted-foreground">Tier</p>
              <p className="font-body font-semibold text-marine text-lg">
                {tier.name}
              </p>
              {tier.guest_invitations_per_season > 0 && (
                <p className="text-xs text-muted-foreground font-body mt-1">
                  {tier.guest_invitations_per_season} guest invitation
                  {tier.guest_invitations_per_season !== 1 ? "s" : ""} per season
                </p>
              )}
            </div>
          )}
          {member.member_number && (
            <p className="mt-3 font-accent text-sm uppercase tracking-wider text-sky-dark">
              {member.member_number}
            </p>
          )}
        </div>

        {/* Card Preview */}
        {card && member.status === "active" ? (
          <Link
            href="/card"
            className="bg-marine rounded-xl p-6 text-white hover:bg-marine-light transition-colors group"
          >
            <p className="text-sm text-white/60 font-body mb-2">
              Digital Membership Card
            </p>
            <p className="font-heading text-xl font-bold">
              {member.first_name} {member.last_name}
            </p>
            <p className="font-accent text-sm uppercase tracking-wider text-sky mt-1">
              {card.card_number}
            </p>
            <p className="text-xs text-white/50 font-body mt-3">
              Valid until{" "}
              {new Date(card.valid_until).toLocaleDateString("en-GB", {
                month: "long",
                year: "numeric",
              })}
            </p>
            <p className="text-xs text-sky font-body mt-3 group-hover:underline">
              View full card &rarr;
            </p>
          </Link>
        ) : (
          <div className="bg-white rounded-xl border border-border p-6">
            <p className="text-sm font-body text-muted-foreground mb-2">
              Digital Membership Card
            </p>
            <p className="text-sm font-body text-marine">
              {member.status === "approved"
                ? "Your card will be available once payment is confirmed."
                : member.status === "pending"
                  ? "Your card will be issued once your application is approved."
                  : "No active card."}
            </p>
          </div>
        )}

        {/* Season Info */}
        {season && (
          <div className="bg-white rounded-xl border border-border p-6">
            <p className="text-sm font-body text-muted-foreground mb-2">
              {season.year} Season
            </p>
            <p className="font-body text-marine">
              {new Date(season.start_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              })}{" "}
              —{" "}
              {new Date(season.end_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
