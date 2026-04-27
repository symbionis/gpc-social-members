import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

function formatDateRange(startDate: string, endDate: string | null) {
  const start = new Date(startDate);
  const startDay = start.getDate();
  const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
  const startYear = start.getFullYear();

  if (!endDate || endDate === startDate) {
    return `${startDay} ${startMonth} ${startYear}`;
  }
  const end = new Date(endDate);
  const endDay = end.getDate();
  const endMonth = end.toLocaleDateString("en-GB", { month: "long" });
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return `${startDay}–${endDay} ${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
  }
  return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
}

export default async function PublicEventsPage() {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("events")
    .select("id, title, start_date, end_date, start_time, location, image_url, registration_enabled")
    .eq("is_published", true)
    .eq("visibility", "public")
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="bg-cream min-h-[calc(100vh-5rem)] py-12">
        <div className="mx-auto max-w-4xl px-6">
        <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
          Public Events
        </p>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
          Upcoming Events
        </h1>

        {!events || events.length === 0 ? (
          <div className="bg-white rounded-xl border border-border p-8 text-center">
            <p className="text-muted-foreground font-body">
              No public events scheduled at the moment. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/public/events/${event.id}`}
                className="block bg-white rounded-xl border border-border p-5 hover:border-sky/50 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-body font-semibold text-marine">
                      {event.title}
                    </p>
                    <p className="text-sm font-body text-muted-foreground mt-1">
                      {formatDateRange(event.start_date, event.end_date)}
                      {event.start_time
                        ? ` at ${event.start_time.slice(0, 5)}`
                        : ""}
                    </p>
                    {event.location && (
                      <p className="text-xs font-body text-muted-foreground mt-1">
                        {event.location}
                      </p>
                    )}
                    {event.registration_enabled && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-body font-medium bg-sky/10 text-sky-dark">
                        Registration open
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 mt-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        </div>
      </div>
    </>
  );
}
