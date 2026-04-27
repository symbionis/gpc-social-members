import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import EventRegistrationForm from "@/components/public/EventRegistrationForm";

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ registered?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const { registered, cancelled } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, status, first_name, last_name, email")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "active") {
    redirect("/dashboard");
  }

  const { data: event } = await adminClient
    .from("events")
    .select("*, event_types(name, slug, color)")
    .eq("id", id)
    .eq("is_published", true)
    .single();

  if (!event) notFound();

  const eventType = event.event_types as Record<string, string> | null;

  function renderDescription(text: string) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-dark underline underline-offset-2 hover:text-marine transition-colors break-all"
        >
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

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
      return `${startDay}\u2013${endDay} ${startMonth} ${startYear}`;
    }
    if (startYear === endYear) {
      return `${startDay} ${startMonth} \u2013 ${endDay} ${endMonth} ${startYear}`;
    }
    return `${startDay} ${startMonth} ${startYear} \u2013 ${endDay} ${endMonth} ${endYear}`;
  }

  return (
    <div>
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-6"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Events
      </Link>

      {registered === "1" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
          <p className="font-body text-sm text-emerald-900">
            Payment received. A confirmation email is on its way — check your
            inbox.
          </p>
        </div>
      )}
      {cancelled === "1" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
          <p className="font-body text-sm text-amber-900">
            Checkout cancelled. Your registration has not been confirmed.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="p-6 sm:p-8">
          {eventType && (
            <div className="flex items-center gap-2 mb-3">
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

          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-4">
            {event.title}
          </h1>

          {/* Date, time, location */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-body text-muted-foreground">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>
                {formatDateRange(event.start_date, event.end_date)}
              </span>
              {!event.is_confirmed && (
                <span className="px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                  Dates TBC
                </span>
              )}
            </div>

            {event.start_time && (
              <div className="flex items-center gap-2 text-sm font-body text-muted-foreground">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{event.start_time.slice(0, 5)}</span>
              </div>
            )}

            {event.location && (
              <div className="flex items-center gap-2 text-sm font-body text-muted-foreground">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span>{event.location}</span>
              </div>
            )}
          </div>
        </div>

        {/* Images */}
        {(event.image_url || event.image_url_2) && (
          <div className="px-6 sm:px-8 pb-6">
            <div className={`grid gap-3 ${event.image_url && event.image_url_2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
              {event.image_url && (
                <img
                  src={event.image_url}
                  alt={event.title}
                  className="w-full rounded-lg border border-border object-cover max-h-[400px]"
                />
              )}
              {event.image_url_2 && (
                <img
                  src={event.image_url_2}
                  alt={event.title}
                  className="w-full rounded-lg border border-border object-cover max-h-[400px]"
                />
              )}
            </div>
          </div>
        )}

        {/* Description */}
        {event.description && (
          <div className="px-6 sm:px-8 pb-8">
            <hr className="border-border mb-6" />
            <div className="prose prose-sm max-w-none font-body text-muted-foreground leading-relaxed whitespace-pre-line">
              {renderDescription(event.description)}
            </div>
          </div>
        )}
      </div>

      {event.registration_enabled && (
        <div className="mt-6 bg-white rounded-xl border border-border p-6 sm:p-8">
          <h2 className="font-heading text-xl font-bold text-marine mb-4">
            Register
          </h2>
          <EventRegistrationForm
            eventId={event.id}
            priceMember={Number(event.price_member ?? 0)}
            priceNonMember={Number(event.price_non_member ?? 0)}
            defaultName={`${member.first_name ?? ""} ${member.last_name ?? ""}`.trim()}
            defaultEmail={member.email ?? ""}
          />
        </div>
      )}

      <div className="mt-6">
        <Link
          href="/events"
          className="text-sm font-body text-muted-foreground hover:text-marine transition-colors"
        >
          &larr; Back to Events
        </Link>
      </div>
    </div>
  );
}
