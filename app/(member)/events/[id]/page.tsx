import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import EventRegistrationForm from "@/components/public/EventRegistrationForm";
import EventGallery from "@/components/EventGallery";

function coerceImages(value: unknown, fallbacks: (string | null | undefined)[]): string[] {
  if (Array.isArray(value)) {
    const cleaned = value.filter((u): u is string => typeof u === "string" && u.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  return fallbacks.filter((u): u is string => typeof u === "string" && u.length > 0);
}

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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="bg-white rounded-xl border border-border overflow-hidden">
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

            <p className="font-body text-lg sm:text-xl font-semibold text-sky-dark mb-2">
              {formatDateRange(event.start_date, event.end_date)}
              {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ""}
              {!event.is_confirmed && (
                <span className="ml-2 align-middle px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                  Dates TBC
                </span>
              )}
            </p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-2">
              {event.title}
            </h1>
            {event.location && (
              <p className="text-base font-body text-muted-foreground mb-4">
                {event.location}
              </p>
            )}

            {(() => {
              const imgs = coerceImages(event.images, [event.image_url, event.image_url_2]);
              return imgs.length > 0 ? (
                <div className="mb-6">
                  <EventGallery images={imgs} alt={event.title} />
                </div>
              ) : null;
            })()}

            {event.description && (
              <div className="font-body text-muted-foreground leading-relaxed whitespace-pre-line">
                {renderDescription(event.description)}
              </div>
            )}
          </div>
        </div>

        <aside className="bg-white rounded-xl border border-border p-6 self-start">
          {event.registration_enabled ? (
            <>
              <h2 className="font-heading text-xl font-bold text-marine mb-4">
                Register
              </h2>
              <EventRegistrationForm
                eventId={event.id}
                priceMember={Number(event.price_member ?? 0)}
                priceNonMember={Number(event.price_non_member ?? 0)}
                defaultName={`${member.first_name ?? ""} ${member.last_name ?? ""}`.trim()}
                defaultEmail={member.email ?? ""}
                memberOnly
              />
            </>
          ) : (
            <p className="font-body text-sm text-muted-foreground">
              Information only — registration is not open for this event.
            </p>
          )}
        </aside>
      </div>

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
