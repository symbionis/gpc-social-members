"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency } from "@/lib/format";
import { eligibleConvertTargets, type ConvertType } from "@/lib/events/convert-eligibility";
import type { TicketCancellationStatus } from "@/lib/events/refunds";
import WaiverModal from "@/components/events/WaiverModal";
import PhoneInput from "@/components/common/PhoneInput";
import BuyMorePanel from "@/components/public/BuyMorePanel";

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
  phone: string;
  typeId: string;
  typeTitle: string;
  checkedIn: boolean;
  /** Holder cancellation (U14): null = live; 'requested'/'refunded' = cancelled. */
  cancellationStatus: TicketCancellationStatus | null;
  /** QR admission URL (/c/<credential_token>). */
  credentialUrl: string;
  /** Whether this holder has already accepted the waiver — signing early skips it at the door. */
  waiverSigned: boolean;
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
  /** POST { ticketId, language, marketingConsent } — accept the waiver ahead of the event. */
  waiverEndpoint: string;
  /** All active types priced at the booking's rate — filtered per ticket to upgrade targets. */
  convertTypes: ConvertType[];
  /** When set, show the "buy more tickets" panel posting to this endpoint (U2). Any holder
   *  on this booking can buy more — not just the lead — reusing the same top-up route the
   *  lead's booking page uses (KTD1). No seat it buys is for the buyer themselves. */
  topupEndpoint?: string;
  /** Ticket types the holder can buy more of (with a display price label). */
  buyableTypes?: { id: string; title: string; priceLabel: string }[];
  /** Receipt page link (U6, R22/AE10) — passed only when this token is the payer's own
   *  (tickets.is_lead), the same gate the receipt route itself checks. null/absent hides the
   *  link entirely, so a non-payer household member sees no trace of it. */
  receiptUrl?: string | null;
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
  waiverEndpoint,
  convertTypes,
  topupEndpoint,
  buyableTypes,
  receiptUrl,
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

      {(referenceCode || calendarUrl || receiptUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3.5 text-base font-body">
          {referenceCode ? (
            <span className="text-marine/80">
              Booking <span className="font-semibold text-marine">{referenceCode}</span>
            </span>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {receiptUrl && (
              <a
                href={receiptUrl}
                className="font-body font-semibold text-marine underline underline-offset-2"
              >
                View receipt
              </a>
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
        </div>
      )}

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketCard
            key={t.id}
            ticket={t}
            index={i + 1}
            many={many}
            total={tickets.length}
            fillEndpoint={fillEndpoint}
            convertEndpoint={convertEndpoint}
            cancelEndpoint={cancelEndpoint}
            waiverEndpoint={waiverEndpoint}
            convertTypes={convertTypes}
            onSaved={onSaved}
          />
        ))}
      </ul>

      {topupEndpoint && buyableTypes && buyableTypes.length > 0 && (
        <BuyMorePanel endpoint={topupEndpoint} types={buyableTypes} />
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  index,
  many,
  total,
  fillEndpoint,
  convertEndpoint,
  cancelEndpoint,
  waiverEndpoint,
  convertTypes,
  onSaved,
}: {
  ticket: ManageTicket;
  index: number;
  many: boolean;
  total: number;
  fillEndpoint: string;
  convertEndpoint: string;
  cancelEndpoint: string;
  waiverEndpoint: string;
  convertTypes: ConvertType[];
  onSaved: (t: ManageTicket) => void;
}) {
  const targets = eligibleConvertTargets(ticket.typeId, convertTypes);
  const currentPrice = convertTypes.find((t) => t.id === ticket.typeId)?.price ?? 0;
  const cancelled = ticket.cancellationStatus !== null;
  // A cancelled ticket is spent — no editing, upgrading, or re-cancelling it.
  const canEdit = !ticket.checkedIn && !cancelled;
  // A waiver attests to a person, so there has to be one. Naming a seat also clears any
  // acceptance on it (fill_ticket), so signing first would be wiped by the Edit below —
  // the route refuses this too; hiding it here is so the control never invites a dead end.
  const canSign = canEdit && ticket.name.trim() !== "";

  return (
    <li className="relative rounded-2xl border border-border/70 bg-white p-4 shadow-sm sm:p-5">
      {/* Which of several tickets this is — a quiet corner label, not a heading. With one
          ticket there is nothing to disambiguate, so it is omitted entirely. */}
      {many && (
        <span className="absolute right-4 top-4 font-body text-xs text-marine/45">
          {index} of {total}
        </span>
      )}

      {/* Stacks on a phone (where this page is nearly always read) and sits side by side from
          `sm` up. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="shrink-0 self-start rounded-lg border border-border/60 bg-white p-2">
          <QRCodeSVG value={ticket.credentialUrl} size={112} fgColor="#052938" bgColor="#FFFFFF" level="M" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Name leads — it is what the holder scans for when three tickets look alike. */}
          <p
            className={`font-heading text-lg font-bold leading-tight text-marine ${
              cancelled ? "text-marine/50 line-through" : ""
            }`}
          >
            {ticket.name || <span className="font-body font-normal text-marine/60">Unnamed ticket</span>}
          </p>
          {ticket.email && (
            <p className="truncate font-body text-sm text-marine/70">{ticket.email}</p>
          )}
          {ticket.phone && (
            <p className="truncate font-body text-sm text-marine/70">{ticket.phone}</p>
          )}
          <p className="mt-1 font-body text-sm text-marine/80">{ticket.typeTitle || "Ticket"}</p>

          {/* The primary action sits with the ticket it applies to, not adrift below the QR.
              Full width on a phone (where the column is the whole card), inline from `sm`. */}
          {canSign && (
            <div className="mt-3">
              <WaiverControl
                endpoint={waiverEndpoint}
                ticket={ticket}
                onSigned={() => onSaved({ ...ticket, waiverSigned: true })}
              />
            </div>
          )}

          {/* Status only — never actions. A pill here means "this is true of the ticket". */}
          {(ticket.checkedIn || cancelled || ticket.waiverSigned) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ticket.checkedIn && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-body font-semibold text-emerald-800">
                  Checked in
                </span>
              )}
              {cancelled && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-body font-semibold text-red-800">
                  Cancelled
                </span>
              )}
              {ticket.waiverSigned && !cancelled && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-body text-emerald-800">
                  Waiver signed
                </span>
              )}
            </div>
          )}

          {cancelled && (
            <p className="mt-2 font-body text-sm text-red-700">
              {/* No refund promise: this page cannot tell whether one is owed. A free or comped
                  seat has nothing to refund, and even on a paid one the amount and timing are an
                  admin's decision from the Refunds tab, not something to commit to here. */}
              This ticket has been cancelled and its place released.
            </p>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="mt-4">
          {/* Everything else on one line below a rule: routine self-service to the left,
              cancel pushed to the far right. Separated by distance and by weight rather than
              by a row of its own — the primary action above is the only pill on the card. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-4">
              <EditControl ticket={ticket} endpoint={fillEndpoint} onSaved={onSaved} />
              {targets.length > 0 && (
                <ConvertControl
                  endpoint={convertEndpoint}
                  ticketId={ticket.id}
                  currentPrice={currentPrice}
                  targets={targets}
                />
              )}
            </div>
            <CancelControl
              endpoint={cancelEndpoint}
              ticketId={ticket.id}
              onCancelled={() => onSaved({ ...ticket, cancellationStatus: "requested" })}
            />
          </div>
        </div>
      )}
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
  const [phone, setPhone] = useState(ticket.phone);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the guest has been told what changing the address does, so the next tap saves.
  const [confirmingHandover, setConfirmingHandover] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== ticket.email.trim().toLowerCase();

  const submit = async () => {
    if (!name.trim()) return setError("Enter a name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email.");
    // phone collapses to the same "" whether the field was left blank or the user typed
    // something that doesn't parse — phoneInvalid is the only way to tell those apart, so
    // without this check an invalid number would silently save as blank (R8 covers blank,
    // not garbage).
    if (phoneInvalid) return setError("Enter a valid phone number, or leave it blank.");
    // Changing the address hands the seat to a different person, and that is not obvious from
    // a form that also fixes typos. Three things happen at once, none of them undoable from
    // this page: the ticket leaves this household (siblings are matched on shared email, so it
    // disappears from here), the new address gets its own link and QR, and any signed waiver
    // is cleared. Confirm once, then save.
    if (emailChanged && !confirmingHandover) {
      setConfirmingHandover(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          name: name.trim(),
          email: email.trim(),
          phone,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        emailChanged?: boolean;
        qrEmailSent?: boolean;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      // The save worked; the delivery may not have. Say so here, because once the address
      // changes this page stops showing the ticket and nobody would ever find out.
      if (data.emailChanged && data.qrEmailSent === false) {
        setError(
          `Saved, but we could not email ${email.trim()} their ticket. They have no QR code — save again to retry.`
        );
        setConfirmingHandover(false);
        return;
      }
      onSaved({ ...ticket, name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() });
      setOpen(false);
      setConfirmingHandover(false);
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
        className="font-body text-sm font-semibold text-marine underline underline-offset-2 hover:text-marine-light cursor-pointer"
      >
        Edit holder details
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
        onChange={(e) => {
          setEmail(e.target.value);
          // Re-arm: a confirmation is for the address that was on screen when it was given.
          // Without this, confirming for one address and then typing another would save the
          // second one unconfirmed — and typing the original back would still show a warning
          // about a handover that is no longer happening.
          setConfirmingHandover(false);
        }}
        type="email"
        placeholder="Email"
        className="w-full rounded-lg border border-border/70 px-3 py-2 text-base font-body text-marine"
      />
      <PhoneInput
        id="ticket-phone"
        defaultValue={ticket.phone || null}
        onChange={(v) => setPhone(v ?? "")}
        onValidityChange={setPhoneInvalid}
      />
      {error && <p className="text-sm font-body text-red-600">{error}</p>}
      {/* Consequences before the tap that causes them, not a toast afterwards — none of this
          is undoable from this page once the ticket leaves the household. */}
      {confirmingHandover && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-body text-sm font-semibold text-marine">
            This gives the ticket to someone else
          </p>
          <ul className="list-disc space-y-1 pl-4 font-body text-sm text-marine/80">
            <li>
              It moves to <span className="font-semibold">{email.trim()}</span> and disappears
              from this page — you manage tickets on your own address.
            </li>
            <li>They get their own link and QR code by email.</li>
            {ticket.waiverSigned && (
              <li>
                The waiver signed for {ticket.name || "this ticket"} is cleared — the new holder
                signs their own.
              </li>
            )}
          </ul>
          <p className="font-body text-sm text-marine/70">
            Only fixing a typo? Change it back and save — the address must match to keep the
            ticket here.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className={`flex-1 rounded-lg px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50 ${
            confirmingHandover ? "bg-amber-600" : "bg-marine"
          }`}
        >
          {busy ? "Saving…" : confirmingHandover ? "Yes, give it to them" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmingHandover(false);
            setEmail(ticket.email);
            setName(ticket.name);
            setPhone(ticket.phone);
            setPhoneInvalid(false);
            setError(null);
          }}
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
        className="font-body text-sm font-semibold text-marine underline underline-offset-2 hover:text-marine-light cursor-pointer"
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
        className="font-body text-sm text-marine/50 underline underline-offset-2 transition-colors hover:text-red-700 cursor-pointer"
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

/**
 * Accept the waiver ahead of the event, one ticket at a time.
 *
 * A manage link opens a whole household, so this is deliberately per ticket rather than one
 * control for everyone on the page: signing for someone who never saw it is the thing the
 * booking flow already refuses when a lead names a guest.
 *
 * The payoff is at the gate. recordAttendeeCheckin skips its waiver step for a ticket that
 * already carries waiver_accepted_at, so a guest who signs here is simply waved through.
 */
function WaiverControl({
  endpoint,
  ticket,
  onSigned,
}: {
  endpoint: string;
  ticket: ManageTicket;
  onSigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ticket.waiverSigned) return null;

  const submit = async (language: string, marketingConsent: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, language, marketingConsent }),
      });
      // Parse failures are their own outcome, not an empty success. A 200 carrying something
      // other than this route's JSON — a captive portal's login page, a proxy's error page, a
      // service worker's cached reply — is exactly what a guest on venue wifi hits, and
      // `res.ok` alone cannot tell it from a real acceptance.
      let data: { ok?: boolean; error?: string } | null = null;
      try {
        data = await res.json();
      } catch (err) {
        console.error("[tickets/waiver] response was not JSON", { status: res.status, err });
      }
      // Both conditions, like the edit/convert/cancel controls above. Reporting a signature
      // that was never recorded is worse here than in any of them: the pill replaces the Sign
      // button for the rest of the session, so the guest has no way back to it and arrives at
      // the gate expecting to be waved through.
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Could not record your acceptance.");
        return;
      }
      setOpen(false);
      onSigned();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-full bg-marine px-4 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-marine-light cursor-pointer sm:w-auto"
      >
        Sign the waiver
      </button>
      <WaiverModal
        open={open}
        guestName={ticket.name}
        busy={busy}
        error={error}
        onAccept={({ language, marketingConsent }) => submit(language, marketingConsent)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
