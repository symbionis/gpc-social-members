import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import PayNowButton from "./PayNowButton";
import RenewButton from "./RenewButton";

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
      "id, first_name, last_name, status, tier_id, member_number, metadata"
    )
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member) redirect("/login");

  // First-login redirect: show welcome letter to newly active members
  const metadata = (member.metadata as Record<string, unknown>) || {};
  if (member.status === "active" && !metadata.welcome_seen) {
    redirect("/welcome");
  }

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

  // Get next 3 upcoming published events
  const { data: upcomingEvents } = await adminClient
    .from("events")
    .select("id, title, start_date, end_date, is_confirmed, event_types(name, color)")
    .eq("is_published", true)
    .gte("start_date", new Date().toISOString().slice(0, 10))
    .order("start_date", { ascending: true })
    .limit(3);

  // Get lounge sessions
  const { data: loungeSessions } = await adminClient
    .from("lounge_sessions")
    .select("*");

  const openSessions = (loungeSessions || []).filter(
    (s: Record<string, unknown>) => s.is_open === true
  );

  const dayAbbrev: Record<string, string> = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  };

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
          {member.status === "approved" && <PayNowButton />}
          {member.status === "expired" && <RenewButton />}
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

      {/* ── Social ── */}
      {member.status === "active" && (
        <div className="mt-10">
          <h2 className="font-accent text-base tracking-[0.2em] uppercase text-sky-dark mb-4">Social</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Upcoming Events */}
            <div className="bg-white rounded-xl border border-border p-6">
              <p className="text-sm font-body text-muted-foreground mb-3">
                Upcoming Events
              </p>
              {upcomingEvents && upcomingEvents.length > 0 ? (
                <div className="space-y-3">
                  {upcomingEvents.map((event: Record<string, unknown>) => {
                    const eventType = event.event_types as Record<string, string> | null;
                    const start = new Date(event.start_date as string);
                    const end = event.end_date ? new Date(event.end_date as string) : null;
                    const startDay = start.getDate();
                    const startMonth = start.toLocaleDateString("en-GB", { month: "short" });
                    const dateStr =
                      end && (event.end_date as string) !== (event.start_date as string)
                        ? `${startMonth} ${startDay}\u2013${end.getDate()}`
                        : `${startMonth} ${startDay}`;
                    return (
                      <Link
                        key={event.id as string}
                        href={`/events/${event.id}`}
                        className="flex items-start gap-2 hover:bg-cream/50 -mx-2 px-2 py-1 rounded-lg transition-colors"
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
                          style={{
                            backgroundColor: eventType?.color || "#6b7280",
                          }}
                        />
                        <div className="min-w-0">
                          <p className="font-body text-sm text-marine font-medium truncate">
                            {event.title as string}
                          </p>
                          <p className="text-xs font-body text-muted-foreground">
                            {dateStr}
                            {event.is_confirmed === false && (
                              <span className="ml-1.5 text-amber-600 font-medium">TBC</span>
                            )}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm font-body text-muted-foreground">
                  No upcoming events
                </p>
              )}
              <div className="mt-3">
                <Link
                  href="/events"
                  className="text-xs text-sky-dark font-body hover:underline"
                >
                  View full calendar &rarr;
                </Link>
              </div>
            </div>

            {/* Lounge Status */}
            <div className="bg-white rounded-xl border border-border p-6">
              <p className="text-sm font-body text-muted-foreground mb-2">
                Fieldside Lounge
              </p>
              {openSessions.length > 0 ? (
                <div className="space-y-2">
                  {openSessions.map((session: Record<string, unknown>) => (
                    <div
                      key={session.id as string}
                      className="flex items-center gap-2"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
                      <p className="text-sm font-body text-marine">
                        {dayAbbrev[(session.day_of_week as string)?.toLowerCase()] ||
                          (session.day_of_week as string)}{" "}
                        {(session.time_slot as string) === "am" ? "Morning" : "Afternoon"}
                        {session.field_number ? (
                          <span className="text-muted-foreground">
                            {" "}&mdash; Field {String(session.field_number)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-body text-muted-foreground">
                  No lounge sessions scheduled
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Community ── */}
      {member.status === "active" && (
        <div className="mt-10">
          <h2 className="font-accent text-base tracking-[0.2em] uppercase text-sky-dark mb-4">Community</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <a
              href="https://chat.whatsapp.com/JuKTd9XCImL5tZjwYId48v"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-border p-6 hover:border-sky/50 transition-colors group block"
            >
              <p className="text-sm font-body text-muted-foreground mb-2">
                Connect
              </p>
              <p className="font-body font-semibold text-marine">
                Join the WhatsApp Group
              </p>
              <p className="text-xs text-muted-foreground font-body mt-1 group-hover:text-sky-dark transition-colors">
                Stay up to date with events, offers &amp; club news &rarr;
              </p>
            </a>
          </div>
        </div>
      )}

      {member.status === "active" && (
        <div className="mt-6 text-center">
          <Link
            href="/welcome"
            className="text-xs font-body text-muted-foreground underline underline-offset-4 hover:text-marine transition-colors"
          >
            View welcome letter
          </Link>
        </div>
      )}
    </div>
  );
}
