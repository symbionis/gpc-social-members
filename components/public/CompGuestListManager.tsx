"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import BuyMorePanel from "@/components/public/BuyMorePanel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Comp guest-list view (U8, extracted from the retired BookingManager). The one surviving
// surface for a comp GUEST LIST registration (event_registrations.is_guest_list) — a
// sponsor names their contactless comp guests and sees each guest's QR, plus their own
// paid seat(s) if the booking has any, and can buy more paid seats onto their comp list
// (KTD2: sponsors buying paid seats is part of why this page survives). Phone correction and
// ticket-type conversion belonged to ordinary registrations, which now manage themselves from
// the payer's ticket page (U3) — so those aren't here.

export interface CompGuestTicket {
  id: string;
  name: string;
  email: string;
  /** Preserved on save but not user-editable here — phone correction moved to the
   *  holder's own ticket page (U1) and isn't part of the sponsor's guest-list surface. */
  phone: string;
  typeTitle: string;
  status: string; // 'issued' | 'claimed'
  checkedIn: boolean;
  credentialUrl: string;
  /** This is the sponsor's own ticket — it stays with them, read-only. */
  isLead: boolean;
}

interface Props {
  eventTitle: string;
  eventDate: string;
  referenceCode: string;
  quantity: number;
  tickets: CompGuestTicket[];
  /** Endpoint that names a ticket by id ({ ticketId, name, email, phone, marketingConsent }). */
  fillEndpoint: string;
  /** When set, show the "buy more tickets" panel posting to this endpoint (KTD2 — the
   *  sponsor's own paid seats onto their comp list). */
  topupEndpoint?: string;
  /** Ticket types the sponsor can buy more of (with a display price label). */
  buyableTypes?: { id: string; title: string; priceLabel: string }[];
}

export default function CompGuestListManager({
  eventTitle,
  eventDate,
  referenceCode,
  quantity,
  tickets: initialTickets,
  fillEndpoint,
  topupEndpoint,
  buyableTypes,
}: Props) {
  const [tickets, setTickets] = useState<CompGuestTicket[]>(initialTickets);
  const namedCount = useMemo(
    () => tickets.filter((t) => t.name.trim().length > 0).length,
    [tickets]
  );

  const onSaved = (updated: CompGuestTicket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="font-heading text-3xl font-bold text-marine">{eventTitle}</h1>
        <p className="mt-1 font-body text-base text-marine/80">{eventDate}</p>
      </header>

      <div className="rounded-2xl border border-marine/20 bg-marine/5 p-5">
        <h2 className="font-heading text-lg font-bold text-marine mb-1.5">Your tickets</h2>
        <p className="font-body text-base leading-relaxed text-marine/90">
          Add each guest’s <strong>name and email</strong> — we’ll email them their own QR
          code. Every guest needs their QR code to get in: <strong>no QR code, no
          bracelet.</strong> Your own ticket’s QR is below and in your confirmation email.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white px-4 py-3.5 text-base font-body">
        <span className="text-marine/80">
          Booking{" "}
          {referenceCode && <span className="font-semibold text-marine">{referenceCode}</span>}
        </span>
        <span className="text-marine/80">
          <span className="font-semibold text-marine">{namedCount}</span> of {quantity} named
        </span>
      </div>

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketCard key={t.id} fillEndpoint={fillEndpoint} index={i + 1} ticket={t} onSaved={onSaved} />
        ))}
      </ul>

      {topupEndpoint && buyableTypes && buyableTypes.length > 0 && (
        <BuyMorePanel endpoint={topupEndpoint} types={buyableTypes} />
      )}
    </div>
  );
}

function TicketCard({
  fillEndpoint,
  index,
  ticket,
  onSaved,
}: {
  fillEndpoint: string;
  index: number;
  ticket: CompGuestTicket;
  onSaved: (t: CompGuestTicket) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = ticket.name.trim().length > 0;
  // The sponsor's own ticket stays with them; a checked-in ticket is read-only.
  const editable = !ticket.isLead && !ticket.checkedIn;

  // Record the name/contact on the ticket. marketingConsent is always false here: the
  // sponsor must not opt a guest into news on their behalf — each guest opts in themselves.
  // phone is resubmitted unchanged (ticket.phone) — this surface has no phone edit control,
  // and omitting it entirely would null out any phone already on the ticket.
  const fill = async () => {
    const res = await fetch(fillEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketId: ticket.id,
        name,
        email,
        phone: ticket.phone,
        marketingConsent: false,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save. Please try again.");
  };

  // Save the guest's details. The route emails a guest their own QR (no QR, no entry)
  // — so a guest needs a deliverable email, not just any non-empty string.
  const save = async () => {
    if (!name.trim()) {
      setError("Enter the guest’s name.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Add the guest’s email — that’s where we send their QR code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fill();
      onSaved({ ...ticket, name: name.trim(), email, status: "claimed" });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-border/70 bg-white p-5 shadow-sm">
      <div className="flex gap-4">
        <div className="shrink-0 rounded-lg border border-border/60 bg-white p-2">
          <QRCodeSVG value={ticket.credentialUrl} size={112} fgColor="#052938" bgColor="#FFFFFF" level="M" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-base font-bold text-marine">Ticket {index}</span>
            <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body text-marine/80">
              {ticket.typeTitle || "Ticket"}
            </span>
            {ticket.isLead && (
              <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body font-semibold text-marine">
                Your ticket
              </span>
            )}
            {ticket.checkedIn && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                Checked in
              </span>
            )}
          </div>
          <p className="mt-1.5 font-body text-base text-marine">
            {named ? (
              ticket.name
            ) : (
              <span className="text-marine/60">Unnamed — add a name to make this ticket valid</span>
            )}
          </p>
          {(ticket.email || ticket.phone) && (
            <p className="mt-0.5 font-body text-sm text-marine/70">
              {[ticket.email, ticket.phone].filter(Boolean).join(" · ")}
            </p>
          )}
          {editable && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="rounded-lg border border-marine bg-marine px-4 py-2 text-sm font-body font-semibold text-white"
              >
                {named ? "Edit name" : "Add name"}
              </button>
            </div>
          )}
          {ticket.isLead && (
            <p className="mt-2 font-body text-sm text-marine/70">
              This is your own entry QR — also in your confirmation email.
            </p>
          )}
        </div>
      </div>

      {editing && editable && (
        <div className="mt-4 space-y-3 rounded-xl border border-marine/15 bg-marine/5 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest name"
            className="w-full rounded-lg border border-marine/20 bg-white px-3 py-2.5 text-base font-body"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (for their QR code)"
            inputMode="email"
            className="w-full rounded-lg border border-marine/20 bg-white px-3 py-2.5 text-base font-body"
          />
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save & send QR to guest"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="ml-auto rounded-lg px-3 py-2.5 text-base font-body text-marine/70"
            >
              Cancel
            </button>
          </div>
          <p className="font-body text-sm text-marine/70">
            We’ll email this guest their own QR code — they show it at the door.{" "}
            <strong>No QR code, no bracelet.</strong>
          </p>
        </div>
      )}
    </li>
  );
}
