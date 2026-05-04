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

  // Get next 4 upcoming published events for the dashboard event cards
  const { data: upcomingEvents } = await adminClient
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images, visibility, is_confirmed, event_type_id, event_types(name, color)"
    )
    .eq("is_published", true)
    .gte("start_date", new Date().toISOString().slice(0, 10))
    .order("start_date", { ascending: true })
    .limit(4);

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
        Geneva Polo Social Club
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

      {/* ── Events ── */}
      {member.status === "active" && (
        <div className="mt-10">
          <h2 className="font-accent text-base tracking-[0.2em] uppercase text-sky-dark mb-4">
            Upcoming Events
          </h2>
          {upcomingEvents && upcomingEvents.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {upcomingEvents.map((event: Record<string, unknown>) => {
                const eventType = event.event_types as Record<string, string> | null;
                const start = new Date(event.start_date as string);
                const end = event.end_date ? new Date(event.end_date as string) : null;
                const startDay = start.getDate();
                const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
                const startYear = start.getFullYear();
                const dateStr =
                  end && (event.end_date as string) !== (event.start_date as string)
                    ? start.getMonth() === end.getMonth()
                      ? `${startDay}-${end.getDate()} ${startMonth} ${startYear}`
                      : `${startDay} ${startMonth} - ${end.getDate()} ${end.toLocaleDateString("en-GB", { month: "long" })} ${startYear}`
                    : `${startDay} ${startMonth} ${startYear}`;
                const imagesField = event.images;
                const heroFromArray = Array.isArray(imagesField)
                  ? (imagesField.find(
                      (u): u is string => typeof u === "string" && u.length > 0
                    ) ?? null)
                  : null;
                const hero =
                  heroFromArray ||
                  (typeof event.image_url === "string" && event.image_url.length > 0
                    ? event.image_url
                    : null) ||
                  (typeof event.image_url_2 === "string" && event.image_url_2.length > 0
                    ? event.image_url_2
                    : null);
                return (
                  <Link
                    key={event.id as string}
                    href={`/events/${event.id}`}
                    className="bg-white rounded-sm border border-border/60 overflow-hidden flex flex-col hover:border-sky/50 hover:shadow-sm transition-all"
                  >
                    {hero ? (
                      <div className="aspect-square bg-cream/50">
                        <img
                          src={hero}
                          alt={event.title as string}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-square bg-cream/60" />
                    )}
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-1.5 flex-wrap mb-2">
                        {eventType && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-body bg-marine/5 text-marine">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: eventType.color }}
                            />
                            {eventType.name}
                          </span>
                        )}
                        {event.is_confirmed === false && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-body font-medium bg-amber-100 text-amber-800">
                            TBC
                          </span>
                        )}
                      </div>
                      <p className="font-body text-xs font-semibold text-sky-dark">
                        {dateStr}
                      </p>
                      <h3 className="font-heading text-base font-bold text-marine mt-1 leading-snug">
                        {event.title as string}
                      </h3>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-border p-6 text-center">
              <p className="text-sm font-body text-muted-foreground">
                No upcoming events
              </p>
            </div>
          )}
          <div className="mt-6 text-center">
            <Link
              href="/events"
              className="inline-block px-5 py-2.5 rounded-full bg-marine text-white font-body font-medium text-sm hover:bg-marine-light transition-colors"
            >
              View full calendar →
            </Link>
          </div>
        </div>
      )}

      {/* ── Lounge ── */}
      {member.status === "active" && (
        <div className="mt-10">
          <h2 className="font-accent text-base tracking-[0.2em] uppercase text-sky-dark mb-4">
            Fieldside Lounge
          </h2>
          <div className="bg-white rounded-xl border border-border p-6">
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
