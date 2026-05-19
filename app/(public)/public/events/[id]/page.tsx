import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import EventRegistrationDrawer from "@/components/public/EventRegistrationDrawer";
import EventFullyBookedBlock from "@/components/public/EventFullyBookedBlock";
import EventGallery from "@/components/EventGallery";
import { deriveSeatState, getSeatsUsed } from "@/lib/events/seat-usage";

const APPLY_URL = "/apply/GPC-2026";

function coerceImages(value: unknown, fallbacks: (string | null | undefined)[]): string[] {
  if (Array.isArray(value)) {
    const cleaned = value.filter((u): u is string => typeof u === "string" && u.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  return fallbacks.filter((u): u is string => typeof u === "string" && u.length > 0);
}

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

function formatMonthOnly(startDate: string, endDate: string | null) {
  const start = new Date(startDate);
  const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
  const startYear = start.getFullYear();
  if (!endDate || endDate === startDate) return `${startMonth} ${startYear}`;
  const end = new Date(endDate);
  const endMonth = end.toLocaleDateString("en-GB", { month: "long" });
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} – ${endMonth} ${startYear}`;
  }
  return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
}

function priceLabel(value: number): string {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
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
    .select("*, event_types(name, slug, color)")
    .eq("id", id)
    .eq("is_published", true)
    .single();

  if (!event) notFound();

  const isMembersOnly = event.visibility !== "public";
  const eventType = event.event_types as
    | { name: string; color: string }
    | null;
  const images = coerceImages(event.images, [event.image_url, event.image_url_2]);
  const priceMember = Number(event.price_member ?? 0);
  const priceNonMember = Number(event.price_non_member ?? 0);

  // Capacity state. Skip the count query for uncapped events. On lookup
  // failure, degrade to "uncapped" rendering — the register POST handler
  // still recounts before insert, so the cap will be enforced even if the
  // page-render lookup blips. Closed events also get an immediate skip.
  let seatsUsed = 0;
  if (event.seat_cap !== null && event.seat_cap !== undefined) {
    try {
      seatsUsed = await getSeatsUsed(supabase, event.id);
    } catch (err) {
      console.error("[public/events/[id]] seat usage lookup failed", err);
    }
  }
  const { isFullyBooked, seatsRemaining, isLowAvailability } = deriveSeatState({
    seatCap: event.seat_cap,
    seatsUsed,
  });
  const maxQuantity = seatsRemaining ?? undefined;
  const hasSeatCap =
    event.seat_cap !== null && event.seat_cap !== undefined;
  const showLimitedSeatsNote =
    hasSeatCap && !isFullyBooked && !isLowAvailability;

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="bg-cream min-h-[calc(100vh-5rem)] py-12">
        <div className="mx-auto max-w-5xl px-6">
          <Link
            href="/public/events"
            className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-6"
          >
            ← Back to Events
          </Link>

          {registered === "1" && (
            <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-4 mb-4">
              <p className="font-body text-sm text-emerald-900">
                Payment received. A confirmation email is on its way — check
                your inbox.
              </p>
            </div>
          )}
          {cancelled === "1" && (
            <div className="rounded-sm border border-amber-200 bg-amber-50 p-4 mb-4">
              <p className="font-body text-sm text-amber-900">
                Checkout cancelled. Your registration has not been confirmed.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <article className="bg-white rounded-sm border border-border/60 overflow-hidden">
              {images.length > 0 && (
                <EventGallery
                  images={images}
                  alt={event.title}
                  bare
                  fit="contain"
                  aspectClass="aspect-[4/3]"
                />
              )}
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  {eventType && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-body bg-marine/5 text-marine">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: eventType.color }}
                      />
                      {eventType.name}
                    </span>
                  )}
                  {isMembersOnly && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-sky/10 text-sky-dark">
                      Members only
                    </span>
                  )}
                  {event.registration_enabled && isFullyBooked && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-marine/10 text-marine">
                      Fully booked
                    </span>
                  )}
                  {event.registration_enabled && !isFullyBooked && isLowAvailability && seatsRemaining !== null && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                      Only {seatsRemaining} left
                    </span>
                  )}
                  {event.registration_enabled && showLimitedSeatsNote && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-sky/10 text-sky-dark">
                      Limited seats
                    </span>
                  )}
                </div>

                <p className="font-body text-base font-semibold text-sky-dark">
                  {isMembersOnly
                    ? formatMonthOnly(event.start_date, event.end_date)
                    : formatDateRange(event.start_date, event.end_date)}
                  {!isMembersOnly && event.start_time
                    ? ` · ${event.start_time.slice(0, 5)}`
                    : ""}
                </p>
                <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mt-1 mb-2">
                  {event.title}
                </h1>
                {!isMembersOnly && event.location && (
                  <p className="text-base font-body text-muted-foreground mb-4">
                    {event.location}
                  </p>
                )}

                {event.description && (
                  <div className="font-body text-muted-foreground leading-relaxed whitespace-pre-line mt-4">
                    {renderDescription(event.description)}
                  </div>
                )}
              </div>
            </article>

            <aside>
              <div className="bg-white rounded-sm border border-border/60 p-5 lg:sticky lg:top-6">
                {isMembersOnly ? (
                  <>
                    <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-1">
                      Members only
                    </p>
                    <p className="font-body text-sm text-marine mb-4">
                      Apply for membership to join us at events like this one.
                    </p>
                    <Link
                      href={APPLY_URL}
                      className="inline-block w-full text-center px-4 py-3 rounded-lg bg-marine text-white font-body font-medium text-sm hover:bg-marine-light transition-colors cursor-pointer"
                    >
                      Apply for membership →
                    </Link>
                  </>
                ) : !event.registration_enabled ? (
                  <p className="font-body text-sm text-muted-foreground">
                    Information only — registration is not open for this event.
                  </p>
                ) : isFullyBooked ? (
                  <EventFullyBookedBlock eventId={event.id} />
                ) : (
                  <>
                    <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-1">
                      Price
                    </p>
                    <p className="font-heading text-2xl font-bold text-marine mb-4">
                      {priceLabel(priceNonMember)}
                    </p>
                    {isLowAvailability && seatsRemaining !== null && (
                      <p className="font-body text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                        Only {seatsRemaining} {seatsRemaining === 1 ? "seat" : "seats"} left
                      </p>
                    )}
                    <EventRegistrationDrawer
                      eventId={event.id}
                      eventTitle={event.title}
                      priceMember={priceMember}
                      priceNonMember={priceNonMember}
                      maxQuantity={maxQuantity}
                      buttonLabel="Register"
                    />
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
