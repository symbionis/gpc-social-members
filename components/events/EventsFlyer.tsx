"use client";

// Printable, GPC-branded one-page flyer of upcoming events. Rendered on the
// admin-gated /print/events-flyer route; the admin saves it to PDF via the
// browser to share on WhatsApp or pin up at the club.
//
// Client component because qrcode.react renders in the browser. Import only the
// FlyerEvent *type* from lib/events/flyer — importing its runtime would pull the
// server-only service-role Supabase client into the client bundle.

import { QRCodeSVG } from "qrcode.react";
import { formatDate, formatStartTime } from "@/lib/format";
import type { FlyerEvent } from "@/lib/events/flyer";

const CTA_MESSAGE =
  "As a member, please log in to the member portal to register for the events.";

function eventDateLabel(event: FlyerEvent): string {
  const start = formatDate(event.startDate);
  if (event.endDate && event.endDate !== event.startDate) {
    return `${start} – ${formatDate(event.endDate)}`;
  }
  return start;
}

function CallToAction({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="bg-white rounded-lg p-2 shrink-0">
        <QRCodeSVG value={url} size={96} fgColor="#052938" bgColor="#FFFFFF" level="M" />
      </div>
      <div className="min-w-0">
        <p className="font-body text-sm leading-snug text-marine">{CTA_MESSAGE}</p>
        <p className="font-accent text-base tracking-wide text-sky-dark mt-1 break-all">
          {url}
        </p>
      </div>
    </div>
  );
}

export default function EventsFlyer({
  events,
  memberEventsUrl,
}: {
  events: FlyerEvent[];
  memberEventsUrl: string;
}) {
  return (
    <>
      {/* Screen-only toolbar — hidden in print via the .no-print rule. */}
      <div className="no-print flex justify-end p-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-marine px-4 py-2 font-body text-sm font-medium text-white hover:bg-marine-light transition-colors"
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="flyer mx-auto bg-cream text-marine">
        {/* Header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-sky pb-5">
          <div className="flex items-center gap-4">
            {/* Plain img (not next/image) for reliable print rendering. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/polo_club_logo.png"
              alt="Geneva Polo Club"
              width={72}
              height={72}
              className="h-[72px] w-auto"
            />
            <div>
              <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark">
                Geneva Polo Club
              </p>
              <h1 className="font-heading text-3xl font-bold text-marine">
                Upcoming Events
              </h1>
            </div>
          </div>
          <div className="max-w-[320px]">
            <CallToAction url={memberEventsUrl} />
          </div>
        </header>

        {/* Events */}
        <section className="py-5">
          {events.length === 0 ? (
            <p className="font-body text-base text-muted-foreground">
              No upcoming events are confirmed yet — check back soon.
            </p>
          ) : (
            <ul className="space-y-4">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flyer-event flex gap-4 border-b border-sky-light pb-4 last:border-b-0"
                >
                  <div className="shrink-0 text-center w-28">
                    <p className="font-heading text-lg font-bold leading-tight text-marine">
                      {eventDateLabel(event)}
                    </p>
                    {event.startTime && (
                      <p className="font-accent text-lg tracking-wide text-sky-dark">
                        {formatStartTime(event.startTime)}
                      </p>
                    )}
                  </div>
                  {event.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.imageUrl}
                      alt=""
                      width={80}
                      height={80}
                      className="shrink-0 h-20 w-20 rounded-md object-cover border border-sky-light"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-heading text-xl font-semibold text-marine">
                        {event.title}
                      </h2>
                      {event.typeName && (
                        <span className="font-accent text-sm uppercase tracking-wider rounded-full bg-sky px-3 py-0.5 text-marine">
                          {event.typeName}
                        </span>
                      )}
                    </div>
                    {event.description && (
                      <p className="font-body text-sm leading-snug text-marine/80 mt-1">
                        {event.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footer */}
        <footer className="border-t-2 border-sky pt-5">
          <CallToAction url={memberEventsUrl} />
        </footer>
      </article>
    </>
  );
}
