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
  /** This is the lead booker's own ticket — it stays with them (no forwarding). */
  isLead: boolean;
  /** Already handed to a guest via forwarding — shown read-only with an indicator. */
  forwarded: boolean;
}

interface Props {
  eventTitle: string;
  eventDate: string;
  referenceCode: string;
  quantity: number;
  tickets: BookingTicket[];
  /** Endpoint that names a ticket by id ({ ticketId, name, email, phone, marketingConsent }). */
  fillEndpoint: string;
  /** Heading/intro variant: the lead's whole booking vs a delegate's forwarded batch. */
  variant?: "booking" | "batch";
  /** When set, each non-lead ticket gets a "Forward" action posting to this endpoint (lead only). */
  forwardEndpoint?: string;
  /** When set, show the "buy more tickets" panel posting to this endpoint (lead only). */
  topupEndpoint?: string;
  /** Ticket types the lead can buy more of (with a display price label). */
  buyableTypes?: { id: string; title: string; priceLabel: string }[];
}

export default function BookingManager({
  eventTitle,
  eventDate,
  referenceCode,
  quantity,
  tickets: initialTickets,
  fillEndpoint,
  variant = "booking",
  forwardEndpoint,
  topupEndpoint,
  buyableTypes,
}: Props) {
  const [tickets, setTickets] = useState<BookingTicket[]>(initialTickets);
  const namedCount = useMemo(
    () => tickets.filter((t) => t.name.trim().length > 0).length,
    [tickets]
  );

  const onSaved = (updated: BookingTicket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  const onForwarded = (id: string) =>
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, forwarded: true } : t)));

  return (
    <div className="space-y-7">
      <header className="text-center">
        <h1 className="font-heading text-3xl font-bold text-marine">{eventTitle}</h1>
        <p className="mt-1 font-body text-base text-marine/80">{eventDate}</p>
      </header>

      <div className="rounded-2xl border border-marine/20 bg-marine/5 p-5">
        <h2 className="font-heading text-lg font-bold text-marine mb-1.5">Your tickets</h2>
        <p className="font-body text-base leading-relaxed text-marine/90">
          Tickets are nominative — a name must be added to each ticket for it to be valid.
          Add a name to every ticket, then share its QR code with that guest. Each code
          admits one person at the entrance.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white px-4 py-3.5 text-base font-body">
        <span className="text-marine/80">
          {variant === "batch" ? "Forwarded tickets" : "Booking"}{" "}
          {referenceCode && <span className="font-semibold text-marine">{referenceCode}</span>}
        </span>
        <span className="text-marine/80">
          <span className="font-semibold text-marine">{namedCount}</span> of {quantity} named
        </span>
      </div>

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketCard
            key={t.id}
            fillEndpoint={fillEndpoint}
            forwardEndpoint={forwardEndpoint}
            index={i + 1}
            ticket={t}
            onSaved={onSaved}
            onForwarded={onForwarded}
          />
        ))}
      </ul>

      {topupEndpoint && buyableTypes && buyableTypes.length > 0 && (
        <BuyMorePanel endpoint={topupEndpoint} types={buyableTypes} />
      )}
    </div>
  );
}

function BuyMorePanel({
  endpoint,
  types,
}: {
  endpoint: string;
  types: { id: string; title: string; priceLabel: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSelected = Object.values(qty).reduce((s, n) => s + (n || 0), 0);
  const set = (id: string, n: number) =>
    setQty((prev) => ({ ...prev, [id]: Math.max(0, n) }));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const items = Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        checkoutUrl?: string;
        redirectUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not start the top-up.");
        return;
      }
      const next = data.checkoutUrl ?? data.redirectUrl;
      if (next) window.location.href = next;
    } catch {
      setError("Could not start the top-up.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-heading text-base font-bold text-marine">Buy more tickets</span>
        <span className="font-body text-sm text-marine/70">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="font-body text-base text-marine/80">
            Add tickets to this booking. After payment they appear here with their own QR
            codes, ready to name or forward.
          </p>
          <ul className="space-y-3">
            {types.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className="font-body text-base text-marine">
                  {t.title} <span className="text-marine/70">· {t.priceLabel}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Remove one ${t.title}`}
                    onClick={() => set(t.id, (qty[t.id] || 0) - 1)}
                    className="h-9 w-9 rounded-lg border border-border/70 font-body text-lg text-marine"
                  >
                    −
                  </button>
                  <span className="w-7 text-center font-body text-base text-marine">
                    {qty[t.id] || 0}
                  </span>
                  <button
                    type="button"
                    aria-label={`Add one ${t.title}`}
                    onClick={() => set(t.id, (qty[t.id] || 0) + 1)}
                    className="h-9 w-9 rounded-lg border border-border/70 font-body text-lg text-marine"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || totalSelected === 0}
            className="w-full rounded-lg bg-marine px-4 py-3 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Starting…" : `Add ${totalSelected || ""} ticket${totalSelected === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}

function TicketCard({
  fillEndpoint,
  forwardEndpoint,
  index,
  ticket,
  onSaved,
  onForwarded,
}: {
  fillEndpoint: string;
  forwardEndpoint?: string;
  index: number;
  ticket: BookingTicket;
  onSaved: (t: BookingTicket) => void;
  onForwarded: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [phone, setPhone] = useState(ticket.phone);
  const [consent, setConsent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = ticket.name.trim().length > 0;
  // The lead's own ticket stays with them; forwarded tickets are now the guest's to manage.
  const canForward = Boolean(forwardEndpoint) && !ticket.isLead && !ticket.forwarded && !ticket.checkedIn;
  const canEdit = !ticket.checkedIn && !ticket.forwarded;

  const save = async () => {
    setSaving(true);
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
            {ticket.forwarded && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-body font-semibold text-amber-900">
                Forwarded
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
          {(canEdit || canForward) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing((v) => !v);
                    setForwarding(false);
                  }}
                  className="rounded-lg border border-marine bg-marine px-4 py-2 text-sm font-body font-semibold text-white"
                >
                  {named ? "Edit name" : "Add name"}
                </button>
              )}
              {canForward && (
                <button
                  type="button"
                  onClick={() => {
                    setForwarding((v) => !v);
                    setEditing(false);
                  }}
                  className="rounded-lg border border-marine px-4 py-2 text-sm font-body font-semibold text-marine"
                >
                  Forward
                </button>
              )}
            </div>
          )}
          {ticket.forwarded && (
            <p className="mt-2 font-body text-sm text-marine/70">
              Sent to a guest — they can name it and show it at the entrance.
            </p>
          )}
        </div>
      </div>

      {editing && canEdit && (
        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Guest name"
            className="w-full rounded-lg border border-border/70 px-3 py-2.5 text-base font-body"
          />
          {!ticket.isChild && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                inputMode="email"
                className="w-full rounded-lg border border-border/70 px-3 py-2.5 text-base font-body"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (+41…)"
                inputMode="tel"
                className="w-full rounded-lg border border-border/70 px-3 py-2.5 text-base font-body"
              />
            </div>
          )}
          {!ticket.isChild && (
            <label className="flex items-center gap-2 text-sm font-body text-marine/80">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              Keep me posted about club news
            </label>
          )}
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-lg border border-border/70 px-4 py-2.5 text-base font-body text-marine"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {forwarding && canForward && forwardEndpoint && (
        <ForwardTicket
          endpoint={forwardEndpoint}
          ticketId={ticket.id}
          onClose={() => setForwarding(false)}
          onForwarded={() => {
            onForwarded(ticket.id);
            setForwarding(false);
          }}
        />
      )}
    </li>
  );
}

function ForwardTicket({
  endpoint,
  ticketId,
  onClose,
  onForwarded,
}: {
  endpoint: string;
  ticketId: string;
  onClose: () => void;
  onForwarded: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketIds: [ticketId], email: email.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not forward. Please try again.");
        return;
      }
      onForwarded();
    } catch {
      setError("Could not forward. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
      <p className="font-body text-sm text-marine/80">
        Enter the guest’s email. They’ll get this ticket with its QR code and can add their
        own name.
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Recipient email"
        inputMode="email"
        className="w-full rounded-lg border border-border/70 px-3 py-2.5 text-base font-body"
      />
      {error && <p className="text-sm font-body text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending || !email.trim()}
          className="rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Forward ticket"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border/70 px-4 py-2.5 text-base font-body text-marine"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
