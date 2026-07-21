"use client";

import { QRCodeSVG } from "qrcode.react";

// Guest manage page view (U10). Reached via a per-ticket manage_token link. Shows every
// SAME-EMAIL ticket in the booking (the household) — each with its own admission QR — plus
// the event details and an add-to-calendar link. Read-only here; the upgrade / correction /
// cancellation affordances are wired in U11 / U14.

export interface ManageTicket {
  id: string;
  name: string;
  typeTitle: string;
  checkedIn: boolean;
  /** QR admission URL (/c/<credential_token>). */
  credentialUrl: string;
  /** The ticket whose link opened this page. */
  isSelf: boolean;
}

interface Props {
  eventTitle: string;
  eventDate: string;
  eventLocation: string | null;
  referenceCode: string | null;
  calendarUrl: string | null;
  tickets: ManageTicket[];
}

export default function TicketManager({
  eventTitle,
  eventDate,
  eventLocation,
  referenceCode,
  calendarUrl,
  tickets,
}: Props) {
  const many = tickets.length > 1;

  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="font-heading text-3xl font-bold text-marine">{eventTitle}</h1>
        <p className="mt-1 font-body text-base text-marine/80">{eventDate}</p>
        {eventLocation && (
          <p className="mt-0.5 font-body text-sm text-marine/70">{eventLocation}</p>
        )}
      </header>

      <div className="rounded-2xl border border-marine/20 bg-marine/5 p-5">
        <h2 className="font-heading text-lg font-bold text-marine mb-1.5">
          {many ? "Your tickets" : "Your ticket"}
        </h2>
        <p className="font-body text-base leading-relaxed text-marine/90">
          {many
            ? "These tickets are booked to your email. Show each guest their QR code at the door — "
            : "Show this QR code at the door — "}
          <strong>no QR code, no bracelet.</strong>
        </p>
      </div>

      {(referenceCode || calendarUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3.5 text-base font-body">
          {referenceCode ? (
            <span className="text-marine/80">
              Booking <span className="font-semibold text-marine">{referenceCode}</span>
            </span>
          ) : (
            <span />
          )}
          {calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body font-semibold text-marine underline underline-offset-2"
            >
              Add to calendar
            </a>
          )}
        </div>
      )}

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <li key={t.id} className="rounded-2xl border border-border/70 bg-white p-5 shadow-sm">
            <div className="flex gap-4">
              <div className="shrink-0 rounded-lg border border-border/60 bg-white p-2">
                <QRCodeSVG
                  value={t.credentialUrl}
                  size={112}
                  fgColor="#052938"
                  bgColor="#FFFFFF"
                  level="M"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-base font-bold text-marine">
                    {many ? `Ticket ${i + 1}` : "Ticket"}
                  </span>
                  <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body text-marine/80">
                    {t.typeTitle || "Ticket"}
                  </span>
                  {t.isSelf && many && (
                    <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body font-semibold text-marine">
                      This link
                    </span>
                  )}
                  {t.checkedIn && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                      Checked in
                    </span>
                  )}
                </div>
                <p className="mt-1.5 font-body text-base text-marine">
                  {t.name ? (
                    t.name
                  ) : (
                    <span className="text-marine/60">Unnamed ticket</span>
                  )}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
