import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function EventsPage() {
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

  const today = new Date().toISOString().slice(0, 10);

  // Past 30 days cutoff
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const pastCutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  // Fetch upcoming published events
  const { data: upcomingEvents } = await adminClient
    .from("events")
    .select("*, event_types(name, slug, color)")
    .eq("is_published", true)
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  // Fetch recent past events (last 30 days)
  const { data: pastEvents } = await adminClient
    .from("events")
    .select("*, event_types(name, slug, color)")
    .eq("is_published", true)
    .lt("start_date", today)
    .gte("start_date", pastCutoff)
    .order("start_date", { ascending: true });

  type EventWithPast = Record<string, unknown> & { isPast: boolean };

  const allEvents: EventWithPast[] = [
    ...(pastEvents || []).map(
      (e) => ({ ...(e as Record<string, unknown>), isPast: true }) as EventWithPast
    ),
    ...(upcomingEvents || []).map(
      (e) => ({ ...(e as Record<string, unknown>), isPast: false }) as EventWithPast
    ),
  ];

  // Group events by month
  const grouped: Record<string, EventWithPast[]> = {};
  for (const event of allEvents) {
    const date = new Date(event.start_date as string);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(event);
  }

  const sortedMonths = Object.keys(grouped).sort();

  function formatDateRange(startDate: string, endDate: string | null) {
    const start = new Date(startDate);
    const startDay = start.getDate();
    const startMonth = start.toLocaleDateString("en-GB", { month: "long" });

    if (!endDate || endDate === startDate) {
      return `${startMonth} ${startDay}`;
    }

    const end = new Date(endDate);
    const endDay = end.getDate();
    const endMonth = end.toLocaleDateString("en-GB", { month: "long" });

    if (startMonth === endMonth) {
      return `${startMonth} ${startDay}\u2013${endDay}`;
    }
    return `${startMonth} ${startDay} \u2013 ${endMonth} ${endDay}`;
  }

  function formatMonthHeading(key: string) {
    const [year, month] = key.split("-");
    const date = new Date(Number(year), Number(month) - 1);
    return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  return (
    <div>
      <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
        Season Calendar
      </p>
      <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
        Events &amp; Calendar
      </h1>

      <div className="mb-6">
        <a
          href="/Tournament Schedule 2026.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-body text-sky-dark hover:underline"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3"
            />
          </svg>
          Download Tournament Schedule 2026 (PDF)
        </a>
      </div>

      {sortedMonths.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground font-body">
            No upcoming events scheduled yet. Check back soon.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedMonths.map((monthKey) => (
            <div key={monthKey}>
              <h2 className="font-heading text-lg font-semibold text-marine mb-3">
                {formatMonthHeading(monthKey)}
              </h2>
              <div className="space-y-3">
                {grouped[monthKey].map((event) => {
                  const eventType = event.event_types as Record<
                    string,
                    string
                  > | null;
                  return (
                    <div
                      key={event.id as string}
                      className={`bg-white rounded-xl border border-border p-5 ${
                        event.isPast ? "opacity-50" : ""
                      }`}
                    >
                      {eventType && (
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: eventType.color || "#6b7280",
                            }}
                          />
                          <span className="text-xs font-body text-muted-foreground uppercase tracking-wide">
                            {eventType.name}
                          </span>
                        </div>
                      )}
                      <p className="font-body font-semibold text-marine">
                        {event.title as string}
                      </p>
                      <p className="text-sm font-body text-muted-foreground mt-1">
                        {formatDateRange(
                          event.start_date as string,
                          event.end_date as string | null
                        )}
                      </p>
                      {event.location ? (
                        <p className="text-xs font-body text-muted-foreground mt-1">
                          {String(event.location)}
                        </p>
                      ) : null}
                      {event.is_confirmed === false && (
                        <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                          Dates TBC
                        </span>
                      )}
                      {event.isPast && (
                        <span className="inline-block mt-2 ml-2 px-2 py-0.5 rounded-full text-xs font-body font-medium bg-gray-100 text-gray-500">
                          Past
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Link
          href="/dashboard"
          className="text-sm font-body text-muted-foreground hover:text-marine transition-colors"
        >
          &larr; Back to dashboard
        </Link>
      </div>
    </div>
  );
}
