"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import WaiverConsentModal, { type WaiverAcceptance } from "@/components/common/WaiverConsentModal";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ForwardedTicket {
  id: string;
  name: string;
  email: string;
  phone: string;
  typeTitle: string;
  isChild: boolean;
  checkedIn: boolean;
  /** Already named/validated (slot_status 'claimed'). */
  validated: boolean;
  credentialUrl: string;
}

const inputClass =
  "w-full rounded-xl border-2 border-marine/20 bg-white px-4 py-3.5 text-base text-marine font-body focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function ForwardedTickets({
  eventTitle,
  eventDate,
  tickets,
  fillEndpoint,
}: {
  eventTitle: string;
  eventDate: string;
  tickets: ForwardedTicket[];
  fillEndpoint: string;
}) {
  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="font-heading text-3xl font-bold text-marine">{eventTitle}</h1>
        <p className="mt-1 font-body text-base text-marine/80">{eventDate}</p>
      </header>

      <div className="rounded-2xl border border-marine/20 bg-marine/5 p-5">
        <h2 className="mb-1.5 font-heading text-lg font-bold text-marine">Your tickets</h2>
        <p className="font-body text-base leading-relaxed text-marine/90">
          Confirm your details to validate each ticket, then show its QR code at the
          entrance and we’ll scan you straight in. You need your QR code to get in:{" "}
          <strong>no QR code, no bracelet.</strong>
        </p>
      </div>

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketRow key={t.id} fillEndpoint={fillEndpoint} index={i + 1} ticket={t} />
        ))}
      </ul>
    </div>
  );
}

function TicketRow({
  fillEndpoint,
  index,
  ticket,
}: {
  fillEndpoint: string;
  index: number;
  ticket: ForwardedTicket;
}) {
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [phone, setPhone] = useState(ticket.phone);
  const [waiver, setWaiver] = useState<WaiverAcceptance | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [validated, setValidated] = useState(ticket.validated);
  const [savedName, setSavedName] = useState(ticket.name);
  const [editing, setEditing] = useState(!ticket.validated && !ticket.checkedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    if (!name.trim()) {
      setError("Enter the guest’s name.");
      return;
    }
    if (!ticket.isChild && !email.trim() && !phone.trim()) {
      setError("Add an email or phone so we can find you at the door.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(fillEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          name,
          email: ticket.isChild ? "" : email,
          phone: ticket.isChild ? "" : phone,
          waiverAccepted: Boolean(waiver),
          language: waiver?.language,
          marketingConsent: waiver?.marketingConsent ?? false,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not validate. Please try again.");
        return;
      }
      setSavedName(name.trim());
      setValidated(true);
      setEditing(false);
    } catch {
      setError("Could not validate. Please try again.");
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
            {ticket.checkedIn ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                Checked in
              </span>
            ) : validated ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                Valid ✓
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-body font-semibold text-amber-900">
                Needs details
              </span>
            )}
          </div>
          {!editing && (
            <p className="mt-1.5 font-body text-base text-marine">
              {savedName || <span className="text-marine/60">Unnamed</span>}
            </p>
          )}
          {validated && !ticket.checkedIn && (
            <p className="mt-1 font-body text-sm text-marine/70">
              Show this QR code at the entrance.
            </p>
          )}
          {validated && !ticket.checkedIn && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="mt-3 rounded-lg border border-marine px-4 py-2 text-sm font-body font-semibold text-marine"
            >
              {editing ? "Close" : "Edit details"}
            </button>
          )}
        </div>
      </div>

      {editing && !ticket.checkedIn && (
        <div className="mt-4 space-y-3 rounded-xl border border-marine/15 bg-marine/5 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className={inputClass}
            autoComplete="name"
          />
          {!ticket.isChild && (
            <>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                inputMode="email"
                className={inputClass}
                autoComplete="email"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (+41…)"
                inputMode="tel"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className={`w-full rounded-xl border-2 px-4 py-3 text-base font-body font-semibold ${
                  waiver
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-marine/30 bg-white text-marine"
                }`}
              >
                {waiver ? "Terms accepted ✓" : "Agree to terms & waiver"}
              </button>
              <p className="font-body text-sm text-marine/60">
                Optional now — you can also sign the waiver at the door.
              </p>
            </>
          )}
          {error && <p className="font-body text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={validate}
            disabled={busy}
            className="w-full rounded-xl bg-marine px-4 py-3.5 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Validating…" : "Validate ticket"}
          </button>
        </div>
      )}

      <WaiverConsentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAccept={(acceptance) => {
          setWaiver(acceptance);
          setModalOpen(false);
        }}
      />
    </li>
  );
}
