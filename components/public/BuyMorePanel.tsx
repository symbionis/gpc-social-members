"use client";

import { useState } from "react";

/**
 * Buy more tickets onto a booking (U2). Shared by TicketManager (any holder — the seats it
 * buys are never for the buyer, R9) and CompGuestListManager (the sponsor's own lead ticket
 * only). Every row takes its own name and email before payment (R1/R5). Presented as an
 * ordinary purchase (R20) — never call this a "top-up" in guest-facing copy, even though it
 * posts to the top-up route under the hood (KTD1).
 *
 * A floating action below the tickets themselves, closed by default — secondary to the
 * tickets (R3), not competing with them for attention.
 */
export default function BuyMorePanel({
  endpoint,
  types,
  remainingAllowance,
  bookingLimit,
}: {
  endpoint: string;
  types: { id: string; title: string; priceLabel: string }[];
  /** Invite-class bookings only (R5/R7/R11): the booking's remaining whole-booking allowance
   *  (limit − live tickets). Absent/null = unrestricted — a member or public booking is
   *  checkout-only bound and a comp guest list is exempt. */
  remainingAllowance?: number | null;
  /** The resolved limit itself, for the exhausted-state message. Only meaningful alongside
   *  `remainingAllowance`. */
  bookingLimit?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  // Keyed `<ticketTypeId>#<index>` so a name stays attached to its seat when another type's
  // quantity changes — an array keyed by position would shuffle names between people.
  const [guests, setGuests] = useState<Record<string, { name: string; email: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSelected = Object.values(qty).reduce((s, n) => s + (n || 0), 0);
  const bound = remainingAllowance ?? null;
  const atAllowanceCap = bound !== null && totalSelected >= bound;
  const exhausted = bound !== null && bound <= 0;
  const set = (id: string, n: number) => {
    const next = Math.max(0, n);
    if (bound !== null) {
      const others = totalSelected - (qty[id] || 0);
      if (others + next > bound) return; // never assemble a basket over the remaining allowance
    }
    setQty((prev) => ({ ...prev, [id]: next }));
  };

  // One row per seat selected. Every added ticket is named before payment (R1/R5) — the
  // same rule the public checkout and the lead's buy-more panel enforce.
  const seatRows = types.flatMap((t) =>
    Array.from({ length: qty[t.id] || 0 }, (_, i) => ({
      key: `${t.id}#${i}`,
      ticketTypeId: t.id,
      title: t.title,
      index: i,
    })),
  );
  const guestOf = (key: string) => guests[key] ?? { name: "", email: "" };
  const setGuest = (key: string, patch: Partial<{ name: string; email: string }>) =>
    setGuests((prev) => ({ ...prev, [key]: { ...guestOf(key), ...patch } }));
  const allNamed = seatRows.every((r) => {
    const g = guestOf(r.key);
    return g.name.trim() !== "" && g.email.trim() !== "";
  });

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const items = Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
      const attendees = seatRows.map((r) => {
        const g = guestOf(r.key);
        return { ticket_type_id: r.ticketTypeId, name: g.name.trim(), email: g.email.trim() };
      });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, attendees }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        checkoutUrl?: string;
        redirectUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not complete your purchase.");
        return;
      }
      const next = data.checkoutUrl ?? data.redirectUrl;
      if (next) window.location.href = next;
    } catch {
      setError("Could not complete your purchase.");
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
      {open && exhausted && (
        <div className="mt-4">
          <p className="font-body text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {`You've reached the maximum of ${bookingLimit} ticket${bookingLimit === 1 ? "" : "s"} for this booking.`}
          </p>
        </div>
      )}
      {open && !exhausted && (
        <div className="mt-4 space-y-4">
          <p className="font-body text-base text-marine/80">
            Add more tickets to this booking. Name each one below — after payment they appear
            here with their own QR codes.
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
                    disabled={atAllowanceCap}
                    className="h-9 w-9 rounded-lg border border-border/70 font-body text-lg text-marine disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {seatRows.length > 0 && (
            <div className="space-y-3 border-t border-border/70 pt-4">
              <p className="font-body text-sm font-semibold text-marine">
                Who are these tickets for?
              </p>
              {seatRows.map((r) => (
                <div key={r.key} className="space-y-2">
                  <label
                    htmlFor={`buy-more-name-${r.key}`}
                    className="font-body text-sm text-marine/70"
                  >
                    {r.title} · guest {r.index + 1}
                  </label>
                  <input
                    id={`buy-more-name-${r.key}`}
                    type="text"
                    value={guestOf(r.key).name}
                    onChange={(e) => setGuest(r.key, { name: e.target.value })}
                    placeholder="First and last name"
                    autoComplete="off"
                    className="w-full rounded-lg border border-border/70 px-3 py-2 font-body text-base text-marine"
                  />
                  <input
                    id={`buy-more-email-${r.key}`}
                    type="email"
                    value={guestOf(r.key).email}
                    onChange={(e) => setGuest(r.key, { email: e.target.value })}
                    placeholder="Email"
                    aria-label={`${r.title} guest ${r.index + 1} email`}
                    autoComplete="off"
                    className="w-full rounded-lg border border-border/70 px-3 py-2 font-body text-base text-marine"
                  />
                </div>
              ))}
              <p className="font-body text-xs text-marine/60">
                Each ticket needs a name and email so its holder gets their own QR code. Guests
                can share an address if they arrive together.
              </p>
            </div>
          )}
          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || totalSelected === 0 || !allNamed}
            className="w-full rounded-lg bg-marine px-4 py-3 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {submitting
              ? "Starting…"
              : `Buy ${totalSelected || ""} ticket${totalSelected === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
