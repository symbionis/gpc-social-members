"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCurrency } from "@/lib/format";
import { eligibleConvertTargets, type ConvertType } from "@/lib/events/convert-eligibility";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BookingTicket {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** The ticket's current ticket_type_id — used to compute convertible target types. */
  typeId: string;
  typeTitle: string;
  isChild: boolean;
  status: string; // 'issued' | 'claimed'
  checkedIn: boolean;
  credentialUrl: string;
  /** This is the lead booker's own ticket — it stays with them, read-only. */
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
  /** When set, enable forwarding (per-ticket "Save & forward" + multi-select panel). Lead only. */
  forwardEndpoint?: string;
  /** When set, show the "buy more tickets" panel posting to this endpoint (lead only). */
  topupEndpoint?: string;
  /** Ticket types the lead can buy more of (with a display price label). */
  buyableTypes?: { id: string; title: string; priceLabel: string }[];
  /** When set, enable per-ticket "Change ticket type" (upgrade) posting to this endpoint. */
  convertEndpoint?: string;
  /** All active ticket types priced at the booking's rate — filtered per ticket to targets. */
  convertTypes?: ConvertType[];
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
  convertEndpoint,
  convertTypes,
}: Props) {
  const [tickets, setTickets] = useState<BookingTicket[]>(initialTickets);
  const namedCount = useMemo(
    () => tickets.filter((t) => t.name.trim().length > 0).length,
    [tickets]
  );

  const onSaved = (updated: BookingTicket) =>
    setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  const onForwarded = (ids: string[]) => {
    const set = new Set(ids);
    setTickets((prev) => prev.map((t) => (set.has(t.id) ? { ...t, forwarded: true } : t)));
  };

  // Tickets the lead may forward: not their own, not already forwarded, not checked in.
  const forwardable = tickets.filter((t) => !t.isLead && !t.forwarded && !t.checkedIn);

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
          {variant === "batch" ? "Forwarded tickets" : "Booking"}{" "}
          {referenceCode && <span className="font-semibold text-marine">{referenceCode}</span>}
        </span>
        <span className="text-marine/80">
          <span className="font-semibold text-marine">{namedCount}</span> of {quantity} named
        </span>
      </div>

      {forwardEndpoint && forwardable.length > 1 && (
        <ForwardManyPanel
          endpoint={forwardEndpoint}
          tickets={forwardable}
          onForwarded={onForwarded}
        />
      )}

      <ul className="space-y-4">
        {tickets.map((t, i) => (
          <TicketCard
            key={t.id}
            fillEndpoint={fillEndpoint}
            forwardEndpoint={forwardEndpoint}
            convertEndpoint={convertEndpoint}
            convertTypes={convertTypes}
            index={i + 1}
            ticket={t}
            onSaved={onSaved}
            onForwarded={(id) => onForwarded([id])}
          />
        ))}
      </ul>

      {topupEndpoint && buyableTypes && buyableTypes.length > 0 && (
        <BuyMorePanel endpoint={topupEndpoint} types={buyableTypes} />
      )}
    </div>
  );
}

/** Multi-select: forward several tickets to one person (e.g. a family's lead). */
function ForwardManyPanel({
  endpoint,
  tickets,
  onForwarded,
}: {
  endpoint: string;
  tickets: BookingTicket[];
  onForwarded: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid recipient email.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const ids = [...selected];
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketIds: ids, email: email.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; count?: number };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not forward. Please try again.");
        return;
      }
      setSentCount(data.count ?? ids.length);
      onForwarded(ids);
      setSelected(new Set());
      setEmail("");
    } catch {
      setError("Could not forward. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-heading text-base font-bold text-marine">
          Forward several tickets to one person
        </span>
        <span className="font-body text-sm text-marine/70">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3 rounded-xl bg-marine/5 p-4">
          {sentCount !== null && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-body text-emerald-800">
              Sent {sentCount} ticket{sentCount === 1 ? "" : "s"}. They’ll get an email with the
              QR codes and can name each one.
            </p>
          )}
          <p className="font-body text-sm text-marine/80">
            Tick the tickets to send, then enter one recipient’s email — handy for sending a
            whole family’s tickets to that family’s lead.
          </p>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {tickets.map((t, i) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-base font-body text-marine">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <span>
                    Ticket {i + 1} · {t.typeTitle || "Ticket"}
                    {t.name ? ` · ${t.name}` : " · unnamed"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Recipient email"
            inputMode="email"
            className="w-full rounded-lg border border-marine/20 bg-white px-3 py-2.5 text-base font-body"
          />
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <button
            type="button"
            onClick={send}
            disabled={sending || selected.size === 0 || !email.trim()}
            className="w-full rounded-lg bg-marine px-4 py-3 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {sending ? "Sending…" : `Forward ${selected.size || ""} ticket${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
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

/** Per-ticket upgrade control: pick a same-or-higher priced target, pay the difference. */
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) {
      setError("Choose a ticket type.");
      return;
    }
    setSubmitting(true);
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
      // checkoutUrl → Stripe for the difference; redirectUrl → free (delta 0) change applied.
      const next = data.checkoutUrl ?? data.redirectUrl;
      if (next) window.location.href = next;
    } catch {
      setError("Could not change the ticket type.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-body font-semibold text-marine underline underline-offset-2"
      >
        Change ticket type
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-marine/15 bg-marine/5 p-3">
          <p className="font-body text-sm text-marine/80">
            Upgrade this ticket — you’ll pay any price difference.
          </p>
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
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !choice}
            className="w-full rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Change ticket type"}
          </button>
        </div>
      )}
    </div>
  );
}

function TicketCard({
  fillEndpoint,
  forwardEndpoint,
  convertEndpoint,
  convertTypes,
  index,
  ticket,
  onSaved,
  onForwarded,
}: {
  fillEndpoint: string;
  forwardEndpoint?: string;
  convertEndpoint?: string;
  convertTypes?: ConvertType[];
  index: number;
  ticket: BookingTicket;
  onSaved: (t: BookingTicket) => void;
  onForwarded: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ticket.name);
  const [email, setEmail] = useState(ticket.email);
  const [phone, setPhone] = useState(ticket.phone);
  const [busy, setBusy] = useState<null | "save" | "forward">(null);
  const [error, setError] = useState<string | null>(null);

  const named = ticket.name.trim().length > 0;
  // The lead's own ticket stays with them; forwarded/checked-in tickets are read-only.
  const editable = !ticket.isLead && !ticket.forwarded && !ticket.checkedIn;
  // Per-ticket forward needs the guest's email field, which is hidden for children —
  // children are bundled to a guardian via the multi-select panel instead.
  const canForward = editable && Boolean(forwardEndpoint) && !ticket.isChild;

  // Convert (upgrade) is allowed on the lead's own ticket too — it preserves is_lead. Only
  // forwarded / checked-in tickets are excluded. Offer only same-or-higher priced targets.
  const convertTargets =
    convertEndpoint && convertTypes && !ticket.forwarded && !ticket.checkedIn
      ? eligibleConvertTargets(ticket.typeId, convertTypes)
      : [];
  const currentPrice = convertTypes?.find((t) => t.id === ticket.typeId)?.price ?? 0;

  // Record the name/contact on the ticket. marketingConsent is always false here: the
  // lead must not opt a guest into news on their behalf — each guest opts in themselves.
  const fill = async () => {
    const res = await fetch(fillEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketId: ticket.id,
        name,
        email: ticket.isChild ? "" : email,
        phone: ticket.isChild ? "" : phone,
        marketingConsent: false,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save. Please try again.");
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Enter a name for this ticket.");
      return;
    }
    // Adults need an email — the QR code is delivered by email, so a guest saved with
    // only a phone can never receive their ticket. If the lead doesn't have the guest's
    // email, they should forward the ticket and let the guest fill it in themselves.
    if (!ticket.isChild && !email.trim()) {
      setError(
        canForward
          ? "Add the guest’s email so we can send their QR code — or use Save & forward to let them add their own details."
          : "Add the guest’s email so we can send their QR code."
      );
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await fill();
      onSaved({ ...ticket, name: name.trim(), email, phone, status: "claimed" });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  // Save & send QR: name + email are required. We name the ticket, then hand it to the
  // guest at that email — the forward flow emails them their own QR (no QR, no entry).
  const saveAndForward = async () => {
    if (!forwardEndpoint) return;
    if (!name.trim()) {
      setError("Enter the guest’s name.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Add the guest’s email — that’s where we send their QR code.");
      return;
    }
    setBusy("forward");
    setError(null);
    try {
      if (name.trim()) await fill();
      const res = await fetch(forwardEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketIds: [ticket.id], email: email.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not forward. Please try again.");
      onForwarded(ticket.id);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not forward. Please try again.");
    } finally {
      setBusy(null);
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
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                QR sent to guest ✓
              </span>
            )}
            {ticket.checkedIn && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-body font-semibold text-emerald-800">
                Checked in
              </span>
            )}
          </div>
          {/* A forwarded ticket is the guest's to edit, but the lead still sees whatever
              details are on it — they're managing the party and need to know who's who. */}
          <p className="mt-1.5 font-body text-base text-marine">
            {named ? (
              ticket.name
            ) : ticket.forwarded ? (
              <span className="text-marine/60">Awaiting the guest’s details</span>
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
          {convertTargets.length > 0 && convertEndpoint && (
            <ConvertControl
              endpoint={convertEndpoint}
              ticketId={ticket.id}
              currentPrice={currentPrice}
              targets={convertTargets}
            />
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
          {!ticket.isChild && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (for their QR code)"
                inputMode="email"
                className="w-full rounded-lg border border-marine/20 bg-white px-3 py-2.5 text-base font-body"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone (+41…)"
                inputMode="tel"
                className="w-full rounded-lg border border-marine/20 bg-white px-3 py-2.5 text-base font-body"
              />
            </div>
          )}
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {canForward ? (
              <button
                type="button"
                onClick={saveAndForward}
                disabled={busy !== null}
                className="rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
              >
                {busy === "forward" ? "Sending…" : "Save & send QR to guest"}
              </button>
            ) : (
              <button
                type="button"
                onClick={save}
                disabled={busy !== null}
                className="rounded-lg bg-marine px-4 py-2.5 text-base font-body font-semibold text-white disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            )}
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
          {canForward && (
            <p className="font-body text-sm text-marine/70">
              We’ll email this guest their own QR code — they show it at the door.{" "}
              <strong>No QR code, no bracelet.</strong>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
