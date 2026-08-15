"use client";

import { useMemo, useRef, useState } from "react";
import {
  validateOrder,
  deriveTicketCounts,
  type OrderPerson,
  type OrderBounds,
  type OrderViolation,
} from "@/lib/events/order";

// Buy more tickets onto a booking (U2, widened by U4 onto the shared order module). Used by
// TicketManager (any holder — the seats it buys are never for the buyer, R9). Every row
// takes its own name, email, and ticket type(s) before payment, validated by the same rule
// set checkout uses
// (R18/KD5) — this used to check only that a name and email were non-empty, which is far
// less rigorous than checkout ever was. Presented as an ordinary purchase (R20) — never call
// this a "top-up" in guest-facing copy, even though it posts to the top-up route under the
// hood (KTD1).
//
// A floating action below the tickets themselves, closed by default — secondary to the
// tickets (R3), not competing with them for attention.

/** Upper bound on one buy-more order. No prop plumbs a caller-specific cap through today, so
 *  this mirrors the topup route's own hard cap (MAX_QTY) rather than inventing a new number. */
const MAX_GUESTS = 50;

/** A repeatable guest row (R20) — one row per person, however many ticket types they take. */
interface GuestEntry {
  key: string;
  name: string;
  email: string;
  ticketTypeIds: string[];
}

export default function BuyMorePanel({
  endpoint,
  types,
  heldTypeIds,
}: {
  endpoint: string;
  types: { id: string; title: string; priceLabel: string }[];
  /** Ticket types the holder's household already holds one of. Shown as an informational
   *  "You already have this" badge next to the type — never blocks selecting it, since a
   *  DIFFERENT guest legitimately buying the same type is the ordinary case. */
  heldTypeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [guests, setGuests] = useState<GuestEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every violation from the last client- or server-side validation pass (KD5/R5), keyed by
  // personIndex + field exactly as `validateOrder` returns them — every row here is a guest
  // (no buyer slot, R9), so personIndex N is `guests[N]`.
  const [violations, setViolations] = useState<OrderViolation[]>([]);
  const nextGuestId = useRef(0);

  const heldSet = useMemo(() => new Set(heldTypeIds ?? []), [heldTypeIds]);
  const typeIds = useMemo(() => new Set(types.map((t) => t.id)), [types]);
  const isKnownTicketType = (id: string) => typeIds.has(id);
  // maxTicketsPerPerson mirrors the topup route's bound — one ticket per head (R20).
  const bounds: OrderBounds = { maxPeople: MAX_GUESTS, maxTickets: MAX_GUESTS, maxTicketsPerPerson: 1 };

  const people: OrderPerson[] = useMemo(
    () => guests.map((g) => ({ name: g.name, email: g.email, ticketTypeIds: g.ticketTypeIds })),
    [guests]
  );
  const counts = useMemo(() => deriveTicketCounts(people), [people]);
  const totalSelected = Array.from(counts.values()).reduce((a, b) => a + b, 0);

  const orderScopedViolations = violations.filter((v) => v.personIndex === null);
  function clearViolations() {
    if (violations.length > 0) setViolations([]);
  }

  function addGuest() {
    setGuests((prev) => [...prev, { key: `g${nextGuestId.current++}`, name: "", email: "", ticketTypeIds: [] }]);
    clearViolations();
  }
  function removeGuest(key: string) {
    setGuests((prev) => prev.filter((g) => g.key !== key));
    clearViolations();
  }
  function setGuestField(key: string, field: "name" | "email", value: string) {
    setGuests((prev) => prev.map((g) => (g.key === key ? { ...g, [field]: value } : g)));
    clearViolations();
  }
  // One ticket per head (R20) — selecting replaces rather than accumulates.
  function selectGuestType(key: string, ticketTypeId: string) {
    setGuests((prev) =>
      prev.map((g) => (g.key === key ? { ...g, ticketTypeIds: [ticketTypeId] } : g))
    );
    clearViolations();
  }

  const submit = async () => {
    setError(null);
    const result = validateOrder(people, bounds, isKnownTicketType);
    setViolations(result.violations);
    if (!result.ok) {
      if (!result.violations.some((v) => v.personIndex === null)) {
        setError("Please fix the highlighted guests.");
      }
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          people: people.map((p) => ({ name: p.name.trim(), email: p.email.trim(), ticketTypeIds: p.ticketTypeIds })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        violations?: OrderViolation[];
        checkoutUrl?: string;
        redirectUrl?: string;
      };
      if (!res.ok || !data.ok) {
        if (Array.isArray(data.violations) && data.violations.length > 0) {
          // A server-side rejection, shaped exactly like validateOrder's own result (R5/R18) —
          // mark the offending rows rather than collapsing into one banner.
          setViolations(data.violations);
          if (!data.violations.some((v) => v.personIndex === null)) {
            setError("Please fix the highlighted guests.");
          }
        } else {
          setError(data.error ?? "Could not complete your purchase.");
        }
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
      {open && (
        <div className="mt-4 space-y-4">
          <p className="font-body text-base text-marine/80">Add more tickets to this booking.</p>

          {orderScopedViolations.length > 0 && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 space-y-1">
              {orderScopedViolations.map((v) => (
                <p key={v.rule} className="font-body text-sm text-red-700">{v.message}</p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="font-body text-sm font-semibold text-marine">Who are these tickets for?</p>
            <button
              type="button"
              onClick={addGuest}
              className="font-body text-sm font-semibold text-marine underline underline-offset-2 cursor-pointer"
            >
              + Add guest
            </button>
          </div>

          {guests.map((g, idx) => {
            const nameErr = violations.find((v) => v.personIndex === idx && v.field === "name")?.message;
            const emailErr = violations.find((v) => v.personIndex === idx && v.field === "email")?.message;
            const typesErr = violations.find((v) => v.personIndex === idx && v.field === "ticketTypeIds")?.message;
            return (
              <div key={g.key} className="space-y-2 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between">
                  <p className="font-body text-sm text-marine/70">Guest {idx + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeGuest(g.key)}
                    aria-label={`Remove guest ${idx + 1}`}
                    className="font-body text-xs text-red-700 underline underline-offset-2 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={g.name}
                  onChange={(e) => setGuestField(g.key, "name", e.target.value)}
                  placeholder="First and last name"
                  aria-label={`Guest ${idx + 1} name`}
                  autoComplete="off"
                  className="w-full rounded-lg border border-border/70 px-3 py-2 font-body text-base text-marine"
                />
                {nameErr && <p className="font-body text-xs text-red-600">{nameErr}</p>}
                <input
                  type="email"
                  value={g.email}
                  onChange={(e) => setGuestField(g.key, "email", e.target.value)}
                  placeholder="Email"
                  aria-label={`Guest ${idx + 1} email`}
                  autoComplete="off"
                  className="w-full rounded-lg border border-border/70 px-3 py-2 font-body text-base text-marine"
                />
                {emailErr && <p className="font-body text-xs text-red-600">{emailErr}</p>}
                {/* One ticket per head (R20): a radio group scoped to this guest's row. */}
                <ul className="space-y-1.5" role="radiogroup" aria-label={`Guest ${idx + 1} ticket`}>
                  {types.map((t) => {
                    const checked = g.ticketTypeIds[0] === t.id;
                    return (
                      <li key={t.id}>
                        <label
                          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 cursor-pointer ${
                            checked ? "border-marine bg-marine/5" : "border-border/70"
                          }`}
                        >
                          <span className="font-body text-sm text-marine">
                            {t.title} <span className="text-marine/70">· {t.priceLabel}</span>
                            {heldSet.has(t.id) && (
                              <span className="ml-2 rounded-full bg-marine/10 px-2 py-0.5 text-xs font-body text-marine/70">
                                You already have this
                              </span>
                            )}
                          </span>
                          <input
                            type="radio"
                            name={`topup-guest-ticket-${g.key}`}
                            checked={checked}
                            onChange={() => selectGuestType(g.key, t.id)}
                            aria-label={`Guest ${idx + 1} ${t.title} ticket`}
                            className="h-5 w-5 shrink-0"
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {typesErr && <p className="font-body text-xs text-red-600">{typesErr}</p>}
              </div>
            );
          })}

          {guests.length > 0 && (
            <p className="font-body text-xs text-marine/60">
              Add each guest’s name and email and we’ll email them their QR code.
            </p>
          )}

          {error && <p className="text-sm font-body text-red-600">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={submitting || guests.length === 0}
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
