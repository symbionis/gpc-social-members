"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export interface BookingTicket {
  id: string;
  name: string;
  email: string;
  phone: string;
  typeTitle: string;
  isChild: boolean;
  status: string; // 'issued' | 'claimed'
  checkedIn: boolean;
  credentialUrl: string;
}

interface Props {
  token: string;
  eventTitle: string;
  eventDate: string;
  leadName: string;
  referenceCode: string;
  quantity: number;
  tickets: BookingTicket[];
}

export default function BookingManager({
  token,
  eventTitle,
  eventDate,
  referenceCode,
  quantity,
  tickets: initialTickets,
}: Props) {
  const [tickets, setTickets] = useState<BookingTicket[]>(initialTickets);
  const namedCount = useMemo(
    () => tickets.filter((t) => t.name.trim().length > 0).length,
    [tickets]
  );

  const onSaved = (updated: BookingTicket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="font-heading text-2xl font-bold text-marine">{eventTitle}</h1>
        <p className="font-body text-sm text-marine/70">{eventDate}</p>
      </header>

      {/* Distribution call to action (R9) */}
      <div className="rounded-2xl border border-marine/15 bg-marine/5 p-5">
        <h2 className="font-heading text-base font-bold text-marine mb-1">
          Your tickets
        </h2>
        <p className="font-body text-sm text-marine/75">
          Every guest needs their own QR code to get in. Add a name to each ticket and
          share its QR with that guest — each code admits one person.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-white px-4 py-3 text-sm font-body">
        <span className="text-marine/70">
          Booking <span className="font-semibold text-marine">{referenceCode}</span>
        </span>
        <span className="text-marine/70">
          <span className="font-semibold text-marine">{namedCount}</span> of {quantity} named
        </span>
      </div>

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketCard key={t.id} token={token} index={i + 1} ticket={t} onSaved={onSaved} />
        ))}
      </ul>
    </div>
  );
}

function TicketCard({
  token,
  index,
  ticket,
  onSaved,
}: {
  token: string;
  index: number;
  ticket: BookingTicket;
  onSaved: (t: BookingTicket) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [phone, setPhone] = useState(ticket.phone);
  const [consent, setConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const named = ticket.name.trim().length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/bookings/${token}/fill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          name,
          email: ticket.isChild ? "" : email,
          phone: ticket.isChild ? "" : phone,
          marketingConsent: consent,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      onSaved({ ...ticket, name: name.trim(), email, phone, status: "claimed" });
      setEditing(false);
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ticket.credentialUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the QR is still visible to scan/screenshot */
    }
  };

  return (
    <li className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
      <div className="flex gap-4">
        <div className="shrink-0 rounded-lg border border-border/50 bg-white p-2">
          <QRCodeSVG value={ticket.credentialUrl} size={96} fgColor="#052938" bgColor="#FFFFFF" level="M" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-heading text-sm font-bold text-marine">
              Ticket {index}
            </span>
            <span className="rounded-full bg-marine/10 px-2 py-0.5 text-xs font-body text-marine/70">
              {ticket.typeTitle || "Ticket"}
            </span>
            {ticket.checkedIn && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-body text-emerald-800">
                Checked in
              </span>
            )}
          </div>
          <p className="mt-1 font-body text-sm text-marine">
            {named ? (
              ticket.name
            ) : (
              <span className="text-marine/50">Unnamed — add a name or share this QR</span>
            )}
          </p>
          {!ticket.checkedIn && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs font-body">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="font-semibold text-marine underline-offset-2 hover:underline"
              >
                {named ? "Edit name" : "Add name"}
              </button>
              <button
                type="button"
                onClick={copy}
                className="text-marine/70 underline-offset-2 hover:underline"
              >
                {copied ? "Link copied" : "Copy QR link"}
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && !ticket.checkedIn && (
        <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest name"
            className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
          />
          {!ticket.isChild && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                inputMode="email"
                className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (+41…)"
                inputMode="tel"
                className="w-full rounded-lg border border-border/60 px-3 py-2 text-sm font-body"
              />
            </div>
          )}
          {!ticket.isChild && (
            <label className="flex items-center gap-2 text-xs font-body text-marine/70">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Keep me posted about club events
            </label>
          )}
          {error && <p className="text-xs font-body text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-marine px-4 py-2 text-sm font-body font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-lg border border-border/60 px-4 py-2 text-sm font-body text-marine"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
