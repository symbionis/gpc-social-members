import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import EventRegistrationDrawer from "@/components/public/EventRegistrationDrawer";
import EventFullyBookedBlock from "@/components/public/EventFullyBookedBlock";
import EventGallery from "@/components/EventGallery";
import SeatBadges from "@/components/events/SeatBadges";
import { deriveSeatState, getSeatsUsed } from "@/lib/events/seat-usage";

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

function priceLabel(value: number): string {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
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

  const eventType = event.event_types as
    | { name: string; color: string }
    | null;
  const images = coerceImages(event.images, [event.image_url, event.image_url_2]);
  const memberFullName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();

  // The viewer is always an active member here, so every ticket type resolves to
  // its member price; a null member price means "not open yet".
  const { data: rawTicketTypes } = await adminClient
    .from("event_ticket_types")
    .select("id, title, price_member, sort_order")
    .eq("event_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  const ticketTypeOptions = (rawTicketTypes ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    price: t.price_member,
  }));
  const priceableValues = ticketTypeOptions
    .map((o) => o.price)
    .filter((p): p is number => p !== null);
  const minPrice = priceableValues.length > 0 ? Math.min(...priceableValues) : 0;

  // Capacity state. Degrade to uncapped rendering on lookup failure; the
  // register POST handler still recounts before insert.
  let seatsUsed = 0;
  if (event.seat_cap !== null && event.seat_cap !== undefined) {
    try {
      seatsUsed = await getSeatsUsed(adminClient, event.id);
    } catch (err) {
      console.error("[member/events/[id]] seat usage lookup failed", err);
    }
  }
  const seatState = deriveSeatState({
    seatCap: event.seat_cap,
    seatsUsed,
  });
  const { isFullyBooked, seatsRemaining, isLowAvailability } = seatState;
  const maxQuantity = seatsRemaining ?? undefined;
  const hasSeatCap =
    event.seat_cap !== null && event.seat_cap !== undefined;

  return (
    <div>
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-6"
      >
        ← Back to Events
      </Link>

      {registered === "1" && (
        <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-4 mb-4">
          <p className="font-body text-sm text-emerald-900">
            Payment received. A confirmation email is on its way — check your
            inbox.
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
              {!event.is_confirmed && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                  Dates TBC
                </span>
              )}
              <SeatBadges
                registrationEnabled={event.registration_enabled}
                seatState={hasSeatCap ? seatState : null}
              />
            </div>

            <p className="font-body text-base font-semibold text-sky-dark">
              {formatDateRange(event.start_date, event.end_date)}
              {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ""}
            </p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mt-1 mb-2">
              {event.title}
            </h1>
            {event.location && (
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
            {!event.registration_enabled ? (
              <p className="font-body text-sm text-muted-foreground">
                Information only — registration is not open for this event.
              </p>
            ) : isFullyBooked ? (
              <EventFullyBookedBlock
                eventId={event.id}
                defaultName={memberFullName}
                defaultEmail={member.email ?? ""}
              />
            ) : (
              <>
                <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-1">
                  Member price
                </p>
                <p className="font-heading text-2xl font-bold text-marine mb-4">
                  {priceableValues.length > 1 ? `From ${priceLabel(minPrice)}` : priceLabel(minPrice)}
                </p>
                {isLowAvailability && seatsRemaining !== null && (
                  <p className="font-body text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                    Only {seatsRemaining} {seatsRemaining === 1 ? "ticket" : "tickets"} left
                  </p>
                )}
                <EventRegistrationDrawer
                  eventId={event.id}
                  eventTitle={event.title}
                  ticketTypes={ticketTypeOptions}
                  defaultName={memberFullName}
                  defaultEmail={member.email ?? ""}
                  maxQuantity={maxQuantity}
                  buttonLabel="Register"
                />
              </>
            )}
          </div>
        </aside>
      </div>

      <div className="mt-6">
        <Link
          href="/events"
          className="text-sm font-body text-muted-foreground hover:text-marine transition-colors"
        >
          ← Back to Events
        </Link>
      </div>
    </div>
  );
}
