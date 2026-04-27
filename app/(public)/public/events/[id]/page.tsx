import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import EventRegistrationForm from "@/components/public/EventRegistrationForm";

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
    return `${startDay}–${endDay} ${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
  }
  return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
}

export default async function PublicEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ registered?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const { registered, cancelled } = await searchParams;

  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("is_published", true)
    .eq("visibility", "public")
    .single();

  if (!event) notFound();

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="bg-cream min-h-[calc(100vh-5rem)] py-12">
        <div className="mx-auto max-w-4xl px-6">
        <Link
          href="/public/events"
          className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-6"
        >
          ← Back to Events
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
              <p className="font-accent text-sm tracking-[0.25em] uppercase text-sky-dark font-semibold mb-2">
                {formatDateRange(event.start_date, event.end_date)}
                {event.start_time
                  ? ` · ${event.start_time.slice(0, 5)}`
                  : ""}
              </p>
              <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-2">
                {event.title}
              </h1>
              {event.location && (
                <p className="text-base font-body text-muted-foreground mb-4">
                  {event.location}
                </p>
              )}

              {event.image_url && (
                <img
                  src={event.image_url}
                  alt={event.title}
                  className="w-full rounded-lg border border-border object-cover max-h-[400px] mb-6"
                />
              )}

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
                  showMemberRate={false}
                />
              </>
            ) : (
              <p className="font-body text-sm text-muted-foreground">
                Information only — registration is not open for this event.
              </p>
            )}
          </aside>
        </div>
        </div>
      </div>
    </>
  );
}
