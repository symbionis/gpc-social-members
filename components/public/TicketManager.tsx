"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency } from "@/lib/format";
import { eligibleConvertTargets, type ConvertType } from "@/lib/events/convert-eligibility";

// Guest manage page view (U10 + U11). Reached via a per-ticket manage_token link. Shows
// every SAME-EMAIL ticket in the booking (the household) — each with its own admission QR
// — plus the event details and an add-to-calendar link. A holder can also correct a
// ticket's name/email and upgrade its type (self-serve, U11); both post to the per-ticket
// endpoints, which authorise on the manage_token and restrict changes to this household.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ManageTicket {
  id: string;
  name: string;
  email: string;
  typeId: string;
  typeTitle: string;
  checkedIn: boolean;
  /** Holder cancellation (U14): null = live; 'requested'/'refunded' = cancelled. */
  cancellationStatus: "requested" | "refunded" | null;
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
  /** POST { ticketId, name, email } — correct a ticket's details. */
  fillEndpoint: string;
  /** POST { ticketId, toTicketTypeId } — upgrade a ticket's type. */
  convertEndpoint: string;
  /** POST { ticketId } — request cancellation of a ticket (final; frees the seat). */
  cancelEndpoint: string;
  /** All active types priced at the booking's rate — filtered per ticket to upgrade targets. */
  convertTypes: ConvertType[];
}

export default function TicketManager({
  eventTitle,
  eventDate,
  eventLocation,
  referenceCode,
  calendarUrl,
  tickets: initialTickets,
  fillEndpoint,
  convertEndpoint,
  cancelEndpoint,
  convertTypes,
}: Props) {
  const [tickets, setTickets] = useState<ManageTicket[]>(initialTickets);
  const many = tickets.length > 1;

  const onSaved = (updated: ManageTicket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

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
          <TicketCard
            key={t.id}
            ticket={t}
            index={i + 1}
            many={many}
            fillEndpoint={fillEndpoint}
            convertEndpoint={convertEndpoint}
            cancelEndpoint={cancelEndpoint}
            convertTypes={convertTypes}
            onSaved={onSaved}
          />
        ))}
      </ul>
    </div>
  );
}

function TicketCard({
  ticket,
  index,
  many,
  fillEndpoint,
  convertEndpoint,
  cancelEndpoint,
  convertTypes,
  onSaved,
}: {
  ticket: ManageTicket;
  index: number;
  many: boolean;
  fillEndpoint: string;
  convertEndpoint: string;
  cancelEndpoint: string;
  convertTypes: ConvertType[];
  onSaved: (t: ManageTicket) => void;
}) {
  const targets = eligibleConvertTargets(ticket.typeId, convertTypes);
  const currentPrice = convertTypes.find((t) => t.id === ticket.typeId)?.price ?? 0;
  const cancelled = ticket.cancellationStatus !== null;
  // A cancelled ticket is spent — no editing, upgrading, or re-cancelling it.
  const canEdit = !ticket.checkedIn && !cancelled;

  return (
    <li className="rounded-2xl border border-border/70 bg-white p-5 shadow-sm">
      <div className="flex gap-4">
        <div className="shrink-0 rounded-lg border border-border/60 bg-white p-2">
          <QRCodeSVG value={ticket.credentialUrl} size={112} fgColor="#052938" bgColor="#FFFFFF" level="M" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-base font-bold text-marine">
              {many ? `Ticket ${index}` : "Ticket"}
            </span>
            <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body text-marine/80">
              {ticket.typeTitle || "Ticket"}
            </span>
            {ticket.isSelf && many && (
              <span className="rounded-full bg-marine/10 px-2.5 py-0.5 text-sm font-body font-semibold text-marine">
                This link
              </span>
            )}
            {ticket.checkedIn && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                Checked in
              </span>
            )}
            {cancelled && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-body font-semibold text-red-800">
                Cancelled
              </span>
            )}
          </div>
          <p className={`mt-1.5 font-body text-base text-marine ${cancelled ? "line-through text-marine/60" : ""}`}>
            {ticket.name ? ticket.name : <span className="text-marine/60">Unnamed ticket</span>}
          </p>
          {ticket.email && <p className="font-body text-sm text-marine/70">{ticket.email}</p>}

          {cancelled && (
            <p className="mt-2 font-body text-sm text-red-700">
              This ticket has been cancelled. A refund will follow from the organiser.
            </p>
          )}

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <EditControl ticket={ticket} endpoint={fillEndpoint} onSaved={onSaved} />
              {targets.length > 0 && (
                <ConvertControl
                  endpoint={convertEndpoint}
                  ticketId={ticket.id}
                  currentPrice={currentPrice}
                  targets={targets}
                />
              )}
              <CancelControl
                endpoint={cancelEndpoint}
                ticketId={ticket.id}
                onCancelled={() => onSaved({ ...ticket, cancellationStatus: "requested" })}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Correct a ticket's name / email (posts to the per-ticket fill endpoint). */
function EditControl({
  ticket,
  endpoint,
  onSaved,
}: {
  ticket: ManageTicket;
  endpoint: string;
  onSaved: (t: ManageTicket) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError("Enter a name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, name: name.trim(), email: email.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      onSaved({ ...ticket, name: name.trim(), email: email.trim().toLowerCase() });
      setOpen(false);
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-body font-semibold text-marine underline underline-offset-2"
      >
        Edit name / email
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-marine/15 bg-marine/5 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full name"
        className="w-full rounded-lg border border-border/70 px-3 py-2 text-base font-body text-marine"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        placeholder="Email"
        className="w-full rounded-lg border border-border/70 px-3 py-2 text-base font-body text-marine"
      />
      {error && <p className="text-sm font-body text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border/70 px-4 py-2.5 text-base font-body text-marine"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Upgrade a ticket to a same-or-higher priced type (posts to the per-ticket convert endpoint). */
function ConvertControl({
  endpoint,
  ticketId,
  currentPrice,
  targets,
}: {
  endpoint: string;
  ticketId: string;
  currentPrice: number;
  targets: ConvertType[];
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) return setError("Choose a ticket type.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId, toTicketTypeId: choice }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        checkoutUrl?: string;
        redirectUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not change the ticket type.");
        return;
      }
      const next = data.checkoutUrl ?? data.redirectUrl;
      if (next) window.location.href = next;
    } catch {
      setError("Could not change the ticket type.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-body font-semibold text-marine underline underline-offset-2"
      >
        Change ticket type
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-marine/15 bg-marine/5 p-3">
      <p className="font-body text-sm text-marine/80">Upgrade this ticket — you’ll pay any price difference.</p>
      <ul className="space-y-1">
        {targets.map((t) => {
          const delta = Number((t.price - currentPrice).toFixed(2));
          return (
            <li key={t.id}>
              <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-base font-body text-marine">
                <input
                  type="radio"
                  name={`convert-${ticketId}`}
                  checked={choice === t.id}
                  onChange={() => setChoice(t.id)}
                />
                <span>
                  {t.title}{" "}
                  <span className="text-marine/70">
                    · {delta === 0 ? "no extra cost" : `+${formatCurrency(delta)}`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm font-body text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !choice}
          className="flex-1 rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Starting…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border/70 px-4 py-2.5 text-base font-body text-marine"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Request cancellation of a ticket (U14). Two-step so a stray tap can't cancel: the first
 * click reveals a "this is final" confirmation. On success the seat is freed immediately and
 * the card flips to its cancelled state.
 */
function CancelControl({
  endpoint,
  ticketId,
  onCancelled,
}: {
  endpoint: string;
  ticketId: string;
  onCancelled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not cancel. Please try again.");
        return;
      }
      onCancelled();
    } catch {
      setError("Could not cancel. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-body font-semibold text-red-700 underline underline-offset-2"
      >
        Cancel ticket
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="font-body text-sm text-red-800">
        Cancelling is final — this ticket will be void and its place released. A refund follows
        from the organiser.
      </p>
      {error && <p className="text-sm font-body text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-lg bg-red-700 px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Cancelling…" : "Cancel this ticket"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg border border-border/70 px-4 py-2.5 text-base font-body text-marine"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
