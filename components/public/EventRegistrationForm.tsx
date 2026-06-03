"use client";

import { useState } from "react";
import posthog from "posthog-js";
import PhoneInput from "@/components/common/PhoneInput";

export interface TicketTypeOption {
  id: string;
  title: string;
  /** Price resolved for THIS viewer's rate class; null = not open yet (not selectable). */
  price: number | null;
}

interface Props {
  eventId: string;
  ticketTypes: TicketTypeOption[];
  defaultName?: string;
  defaultEmail?: string;
  /** Remaining-seat cap for capped events; total selected tickets can't exceed it. */
  maxQuantity?: number;
  /** Invite code from the URL, forwarded to the register API (members-only invite flow). */
  code?: string;
}

const MAX_QUANTITY_HARD_CAP = 10;

function priceLabel(value: number) {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
}

export default function EventRegistrationForm({
  eventId,
  ticketTypes,
  defaultName = "",
  defaultEmail = "",
  maxQuantity,
  code,
}: Props) {
  const cap = Math.max(1, Math.min(MAX_QUANTITY_HARD_CAP, maxQuantity ?? MAX_QUANTITY_HARD_CAP));
  const selectable = ticketTypes.filter((t) => t.price !== null);

  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ referenceCode: string } | null>(null);
  const [soldOut, setSoldOut] = useState(false);

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);
  // Sum over selectable (priced) types only — keeps the "a null price never
  // counts as free" invariant local rather than relying on null-priced rows
  // never accruing a quantity.
  const totalAmount = selectable.reduce(
    (sum, t) => sum + (t.price as number) * (quantities[t.id] ?? 0),
    0
  );
  const atCap = totalQuantity >= cap;
  const allFree = selectable.length > 0 && selectable.every((t) => t.price === 0);

  function setQty(id: string, q: number) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, q) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (!email.trim()) return setError("Please enter your email.");
    if (totalQuantity < 1) return setError("Please select at least one ticket.");
    if (totalQuantity > cap) return setError(`A maximum of ${cap} tickets can be booked at once.`);

    const items = ticketTypes
      .filter((t) => (quantities[t.id] ?? 0) > 0)
      .map((t) => ({ ticket_type_id: t.id, quantity: quantities[t.id] }));

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), ...(phone ? { phone } : {}), items, ...(code ? { code } : {}) }),
      });
      const data = await res.json();

      if (!res.ok) {
        const message = data.error || "Could not register. Please try again.";
        if (res.status === 409 && /tickets? remaining/i.test(message)) {
          setSoldOut(true);
        } else {
          setError(message);
        }
        setSubmitting(false);
        return;
      }

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      if (data.success && data.reference_code) {
        // Free path: reload with ?registered=1 so the user sees the same
        // prominent banner as paid users (the inline panel is easy to miss).
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("registered", "1");
          window.location.assign(url.toString());
          return;
        }
        setSuccess({ referenceCode: data.reference_code });
        setSubmitting(false);
        return;
      }

      setError("Unexpected response. Please try again.");
      setSubmitting(false);
    } catch (err) {
      console.error(err);
      try {
        posthog.capture("event_register_network_error", {
          event_id: eventId,
          error: err instanceof Error ? err.message : "unknown",
        });
      } catch {
        /* posthog not initialized — ignore */
      }
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="font-heading text-lg font-bold text-emerald-900 mb-1">You&apos;re registered.</h3>
        <p className="font-body text-sm text-emerald-800">
          A confirmation email is on its way. Reference{" "}
          <span className="font-mono font-semibold">{success.referenceCode}</span>.
        </p>
      </div>
    );
  }

  if (soldOut) {
    return (
      <div className="rounded-xl border border-marine/20 bg-marine/5 p-6 space-y-3">
        <h3 className="font-heading text-lg font-bold text-marine">Sorry — this event just sold out.</h3>
        <p className="font-body text-sm text-marine/80">
          Someone else grabbed the last tickets while you were registering. Refresh the page to join the waitlist.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-block w-full text-center px-4 py-2 rounded-lg bg-marine text-white text-sm font-body font-semibold hover:bg-marine-light transition-colors cursor-pointer"
        >
          Refresh and view waitlist
        </button>
      </div>
    );
  }

  const inputClass =
    "w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

  if (selectable.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Registration details coming soon.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">Full name</label>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" />
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">Phone</label>
        <PhoneInput id="reg-phone" defaultValue={null} onChange={setPhone} />
      </div>

      {/* Per-type quantity grid */}
      <div className="space-y-2">
        <label className="block text-xs font-body text-muted-foreground">Tickets</label>
        {ticketTypes.map((t) => {
          const qty = quantities[t.id] ?? 0;
          const notOpen = t.price === null;
          return (
            <div
              key={t.id}
              className={`flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 ${notOpen ? "opacity-60" : ""}`}
            >
              <div className="min-w-0">
                <p className="font-body text-sm text-marine truncate">{t.title}</p>
                <p className="font-body text-xs text-muted-foreground">
                  {notOpen ? "Not open yet" : priceLabel(t.price as number)}
                </p>
              </div>
              {!notOpen && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setQty(t.id, qty - 1)}
                    disabled={qty === 0}
                    aria-label={`Remove one ${t.title} ticket`}
                    className="w-8 h-8 rounded-full border border-border text-marine disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-body text-sm text-marine" aria-label={`${t.title} quantity`}>
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQty(t.id, qty + 1)}
                    disabled={atCap}
                    aria-label={`Add one ${t.title} ticket`}
                    className="w-8 h-8 rounded-full border border-border text-marine disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {atCap && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Maximum {cap} tickets per order reached.
        </p>
      )}

      {/* Running total — always visible */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="font-body text-sm text-muted-foreground">Total</span>
        <span className="font-heading text-lg font-bold text-marine">
          {totalQuantity > 0 && totalAmount === 0 ? "Free" : `CHF ${totalAmount.toFixed(2)}`}
        </span>
      </div>

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting || totalQuantity < 1}
        className="w-full px-4 py-3 bg-marine text-white rounded-lg text-sm font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {submitting ? "Processing…" : allFree ? "Confirm registration" : "Reserve your spot"}
      </button>
    </form>
  );
}
