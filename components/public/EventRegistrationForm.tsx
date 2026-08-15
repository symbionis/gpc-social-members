"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { joinName, splitName } from "@/lib/names";
import posthog from "posthog-js";
import PhoneInput from "@/components/common/PhoneInput";
import {
  validateOrder,
  deriveTicketCounts,
  type OrderPerson,
  type OrderBounds,
  type OrderViolation,
} from "@/lib/events/order";

export interface TicketTypeOption {
  id: string;
  title: string;
  /** Price resolved for THIS viewer's rate class; null = not open yet (not selectable). */
  price: number | null;
  /** Optional buyer-facing blurb (what's included). Rendered as escaped plain text. */
  description?: string | null;
}

/**
 * U7: props the offer landing (U5) passes to redeem a waitlist offer through the
 * normal checkout. `redeemableQuantity` is already the ceiling U5 computes —
 * `min(entry.quantity, seats free)` — so this component only has to enforce it as
 * an upper bound (R6), never re-derive it and never treat it as an exact total.
 */
export interface OfferMode {
  /** Forwarded to the register API as `offer_token` alongside the order. */
  token: string;
  /** Upper bound on total order quantity. Not the raw entry quantity — U5 already
   *  clamps it to seats free. */
  redeemableQuantity: number;
  /** The waitlist entry's email (KTD8). Rendered read-only; the route pins it
   *  server-side regardless of what this component sends. */
  email: string;
  /** Pre-filled from the entry; unlike email, the buyer may still edit it. */
  name?: string;
  /** Pre-selected when still live and seat-counting. When the id isn't among the
   *  live `ticketTypes` passed in (archived / retired), the form shows a
   *  replacement message and leaves nothing pre-selected (R7). */
  ticketTypeId?: string;
}

interface Props {
  eventId: string;
  ticketTypes: TicketTypeOption[];
  defaultName?: string;
  defaultEmail?: string;
  /** Remaining-seat cap for capped events; total selected tickets can't exceed it.
   *  Ignored when `offer` is set — `offer.redeemableQuantity` is the ceiling then. */
  maxQuantity?: number;
  /** Invite code from the URL, forwarded to the register API (members-only invite flow). */
  code?: string;
  /** Set by the offer landing (U5) to redeem a waitlist offer. */
  offer?: OfferMode;
}

const MAX_QUANTITY_HARD_CAP = 20;

function priceLabel(value: number) {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
}

/** A repeatable guest row in step 2 (R20). One row per person, however many ticket
 *  types they hold — never one row per ticket. */
interface GuestEntry {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  ticketTypeIds: string[];
}

export default function EventRegistrationForm({
  eventId,
  ticketTypes,
  defaultName = "",
  defaultEmail = "",
  maxQuantity,
  code,
  offer,
}: Props) {
  // Offer mode's redeemable quantity IS the ceiling (U5 already clamped it to seats
  // free) — it overrides maxQuantity rather than combining with it.
  const cap = Math.max(
    1,
    Math.min(MAX_QUANTITY_HARD_CAP, (offer ? offer.redeemableQuantity : maxQuantity) ?? MAX_QUANTITY_HARD_CAP)
  );
  const selectable = useMemo(() => ticketTypes.filter((t) => t.price !== null), [ticketTypes]);
  const selectableIds = useMemo(() => new Set(selectable.map((t) => t.id)), [selectable]);
  const isKnownTicketType = (id: string) => selectableIds.has(id);
  // R7: the pre-selected type only holds when it's still live (present with a
  // resolved price). An archived/retired type never appears in `ticketTypes` at
  // all, so its absence here is exactly the signal we need.
  const offerTypeUnavailable = Boolean(
    offer?.ticketTypeId && !selectable.some((t) => t.id === offer.ticketTypeId)
  );

  const [firstName, setFirstName] = useState(() => splitName(offer?.name ?? defaultName).first);
  const [lastName, setLastName] = useState(() => splitName(offer?.name ?? defaultName).last);
  const name = joinName(firstName, lastName);
  const [email, setEmail] = useState(offer?.email ?? defaultEmail);
  const [phone, setPhone] = useState<string | null>(null);
  // The buyer's own ticket type(s) — step 1 (R20). Pre-selected from the offer's
  // requested type when it's still live; otherwise empty until the buyer picks.
  const [buyerTicketTypeIds, setBuyerTicketTypeIds] = useState<string[]>(() =>
    offer?.ticketTypeId && selectable.some((t) => t.id === offer.ticketTypeId) ? [offer.ticketTypeId] : []
  );
  const [step, setStep] = useState<"tickets" | "attendees">("tickets");
  // Repeatable guest rows — step 2 (R20). Empty until "Add guest" is clicked.
  const [guests, setGuests] = useState<GuestEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every violation from the last client- or server-side validation pass (KD5/R5),
  // keyed by personIndex + field exactly as `validateOrder` returns them. Person 0 is
  // always the buyer; person N (N>=1) is `guests[N-1]`.
  const [violations, setViolations] = useState<OrderViolation[]>([]);
  const [success, setSuccess] = useState<{ referenceCode: string } | null>(null);
  const [soldOut, setSoldOut] = useState(false);

  const step2HeadingRef = useRef<HTMLHeadingElement | null>(null);
  const continueBtnRef = useRef<HTMLButtonElement | null>(null);
  const nextGuestId = useRef(0);

  // An order IS a list of people (U1/KD1) — the buyer is people[0], no special
  // treatment beyond position. R21: the buyer's identity for the receipt/manage link
  // is captured separately (name/email/phone state above) from whether they're also
  // one of the people in the order — here they always are, same as today.
  const people: OrderPerson[] = useMemo(
    () => [
      { name, email, ticketTypeIds: buyerTicketTypeIds },
      ...guests.map((g) => ({
        name: joinName(g.firstName, g.lastName),
        email: g.email,
        ticketTypeIds: g.ticketTypeIds,
      })),
    ],
    [name, email, buyerTicketTypeIds, guests]
  );
  // maxTicketsPerPerson mirrors the register route's bound so the radio group and the
  // server agree on what "one ticket per head" means.
  const bounds: OrderBounds = { maxPeople: cap, maxTickets: cap, maxTicketsPerPerson: 1 };
  const counts = useMemo(() => deriveTicketCounts(people), [people]);
  const totalQuantity = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const totalAmount = selectable.reduce(
    (sum, t) => sum + (t.price as number) * (counts.get(t.id) ?? 0),
    0
  );
  const atCap = totalQuantity >= cap;
  const allFree = selectable.length > 0 && selectable.every((t) => t.price === 0);

  // Order-scoped violations (personIndex null) render as a summary banner above the
  // rows, never against any one of them (KD5).
  const orderScopedViolations = violations.filter((v) => v.personIndex === null);
  function fieldError(personIndex: number, field: "name" | "email" | "ticketTypeIds") {
    return violations.find((v) => v.personIndex === personIndex && v.field === field)?.message;
  }
  function clearViolations() {
    if (violations.length > 0) setViolations([]);
  }

  function runValidation() {
    const result = validateOrder(people, bounds, isKnownTicketType);
    setViolations(result.violations);
    return result;
  }

  // One ticket per head (R20) — selecting replaces rather than accumulates.
  function selectBuyerType(id: string) {
    setBuyerTicketTypeIds((prev) => (prev.length === 0 && atCap ? prev : [id]));
    clearViolations();
  }

  function addGuest() {
    setGuests((prev) => [
      ...prev,
      { key: `g${nextGuestId.current++}`, firstName: "", lastName: "", email: "", ticketTypeIds: [] },
    ]);
    clearViolations();
  }

  function removeGuest(key: string) {
    setGuests((prev) => prev.filter((g) => g.key !== key));
    clearViolations();
  }

  function setGuestField(key: string, field: "firstName" | "lastName" | "email", value: string) {
    setGuests((prev) => prev.map((g) => (g.key === key ? { ...g, [field]: value } : g)));
    clearViolations();
  }

  function selectGuestType(key: string, ticketTypeId: string) {
    setGuests((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        // Same swap-is-free rule as the buyer: only an unpicked row is capped.
        if (g.ticketTypeIds.length === 0 && atCap) return g;
        return { ...g, ticketTypeIds: [ticketTypeId] };
      })
    );
    clearViolations();
  }

  function goToAttendees() {
    setError(null);
    // Step 1 only gates on the buyer's own fields (personIndex 0) and order-scoped bounds —
    // guest rows are edited in step 2 and shouldn't block returning to it (e.g. after Back
    // with a guest row left mid-edit). Guest violations surface at submit time instead.
    const result = validateOrder(people, bounds, isKnownTicketType);
    const blocking = result.violations.filter((v) => v.personIndex === 0 || v.personIndex === null);
    setViolations(blocking);
    if (blocking.length > 0) return;
    setStep("attendees");
  }

  // Move focus to the step-2 heading when the naming step opens (perceivable for
  // keyboard/screen-reader users, since this is a view swap with no route change).
  useEffect(() => {
    if (step === "attendees") step2HeadingRef.current?.focus();
    else continueBtnRef.current?.focus();
  }, [step]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = runValidation();
    if (!result.ok) {
      if (!result.violations.some((v) => v.personIndex === null)) {
        setError("Please fix the highlighted details.");
      }
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(phone ? { phone } : {}),
          people: people.map((p) => ({
            name: p.name.trim(),
            email: p.email.trim(),
            ticketTypeIds: p.ticketTypeIds,
          })),
          ...(code ? { code } : {}),
          ...(offer ? { offer_token: offer.token } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const message = data.error || "Could not register. Please try again.";
        if (res.status === 409 && /tickets? remaining/i.test(message)) {
          setSoldOut(true);
        } else if (Array.isArray(data.violations) && data.violations.length > 0) {
          // A server-side rejection, shaped exactly like validateOrder's own result
          // (R5/R18) — mark the offending rows rather than collapsing into one banner.
          setViolations(data.violations as OrderViolation[]);
          if (!(data.violations as OrderViolation[]).some((v) => v.personIndex === null)) {
            setError("Please fix the highlighted details.");
          }
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
    // U7/KTD9: the route's 409 message text is unchanged — only this panel's copy
    // and CTA branch. Offer mode can only reach this by racing page-load against
    // submit (U5's gate already keeps a zero-seats visitor off this form), so there
    // is no waitlist to rejoin: send them back to the offer landing to re-check.
    if (offer) {
      return (
        <div className="rounded-xl border border-marine/20 bg-marine/5 p-6 space-y-3">
          <h3 className="font-heading text-lg font-bold text-marine">Sorry — those seats just went.</h3>
          <p className="font-body text-sm text-marine/80">
            Someone else completed checkout first. Seats can still free up — check your offer link again for the
            latest availability.
          </p>
          <a
            href={`/public/offers/${encodeURIComponent(offer.token)}`}
            className="inline-block w-full text-center px-4 py-2 rounded-lg bg-marine text-white text-sm font-body font-semibold hover:bg-marine-light transition-colors cursor-pointer"
          >
            Check availability
          </a>
        </div>
      );
    }
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

  const totalDisplay = totalQuantity > 0 && totalAmount === 0 ? "Free" : `CHF ${totalAmount.toFixed(2)}`;

  const orderScopedBanner = orderScopedViolations.length > 0 && (
    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 space-y-1">
      {orderScopedViolations.map((v) => (
        <p key={v.rule} className="font-body text-sm text-red-700">{v.message}</p>
      ))}
    </div>
  );

  /**
   * One ticket per head (R20): each person picks exactly one type, so this is a radio
   * group, not a checkbox list. `groupName` scopes the group to one person — sharing it
   * across rows would make the whole order behave as a single mutually-exclusive pick.
   *
   * Switching an existing pick is always allowed even at the order cap: it swaps a
   * ticket rather than adding one, so only a person with nothing selected yet can be
   * blocked by `atCap`.
   */
  function ticketRadios(
    groupName: string,
    selectedId: string | undefined,
    onSelect: (id: string) => void,
    labelFor: (title: string) => string
  ) {
    return (
      <div className="space-y-2" role="radiogroup" aria-label={labelFor("")}>
        {ticketTypes.map((t) => {
          const notOpen = t.price === null;
          const checked = selectedId === t.id;
          const blockedByCap = !selectedId && atCap;
          return (
            <label
              key={t.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                checked ? "border-marine bg-sky/5" : "border-border"
              } ${notOpen || blockedByCap ? "opacity-60" : "cursor-pointer"}`}
            >
              <span className="min-w-0">
                <span className="block font-body text-sm text-marine truncate">{t.title}</span>
                <span className="block font-body text-xs text-muted-foreground">
                  {notOpen ? "Not open yet" : priceLabel(t.price as number)}
                </span>
                {t.description && (
                  <span className="block font-body text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {t.description}
                  </span>
                )}
              </span>
              {!notOpen && (
                <input
                  type="radio"
                  name={groupName}
                  checked={checked}
                  disabled={blockedByCap}
                  onChange={() => onSelect(t.id)}
                  aria-label={labelFor(t.title)}
                  className="h-5 w-5 shrink-0"
                />
              )}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-live="polite">
      <p className="font-body text-xs text-muted-foreground uppercase tracking-wide">
        {step === "tickets" ? "Step 1 of 2 · Your tickets" : "Step 2 of 2 · Who's coming"}
      </p>

      {step === "tickets" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-first-name" className="block text-xs font-body text-muted-foreground mb-1">First name</label>
              <input
                id="reg-first-name"
                type="text"
                required
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearViolations();
                }}
                className={inputClass}
                autoComplete="given-name"
              />
            </div>
            <div>
              <label htmlFor="reg-last-name" className="block text-xs font-body text-muted-foreground mb-1">Last name</label>
              <input
                id="reg-last-name"
                type="text"
                required
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  clearViolations();
                }}
                className={inputClass}
                autoComplete="family-name"
              />
            </div>
          </div>
          {fieldError(0, "name") && (
            <p className="font-body text-xs text-red-700">{fieldError(0, "name")}</p>
          )}

          <div>
            <label htmlFor="reg-email" className="block text-xs font-body text-muted-foreground mb-1">Email</label>
            <input
              id="reg-email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearViolations();
              }}
              readOnly={Boolean(offer)}
              aria-describedby={offer ? "reg-email-pinned" : undefined}
              className={`${inputClass}${offer ? " bg-cream/60 cursor-not-allowed" : ""}`}
              autoComplete="email"
            />
            {offer && (
              <p id="reg-email-pinned" className="font-body text-xs text-muted-foreground mt-1">
                Pinned to your offer.
              </p>
            )}
            {fieldError(0, "email") && (
              <p className="font-body text-xs text-red-700 mt-1">{fieldError(0, "email")}</p>
            )}
          </div>

          <div>
            <label htmlFor="reg-phone" className="block text-xs font-body text-muted-foreground mb-1">Phone</label>
            <PhoneInput id="reg-phone" defaultValue={null} onChange={setPhone} />
          </div>

          {offer && (
            <p className="font-body text-xs text-sky-800 bg-sky/10 border border-sky/30 rounded-lg px-3 py-2">
              You can buy up to {offer.redeemableQuantity} ticket{offer.redeemableQuantity === 1 ? "" : "s"} with
              this offer.
            </p>
          )}

          {offerTypeUnavailable && (
            <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              The ticket you requested is no longer offered. Please choose another below.
            </p>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-body text-muted-foreground">Your ticket</label>
            {ticketRadios(
              "buyer-ticket",
              buyerTicketTypeIds[0],
              selectBuyerType,
              (title) => (title ? `${title} ticket for you` : "Your ticket")
            )}
          </div>
          {fieldError(0, "ticketTypeIds") && (
            <p className="font-body text-xs text-red-700">{fieldError(0, "ticketTypeIds")}</p>
          )}

          <p className="font-body text-xs text-muted-foreground bg-cream/60 border border-border rounded-lg px-3 py-2">
            This is your own ticket. You can book tickets for guests on the next screen.
          </p>

          {atCap && (
            <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Maximum {cap} tickets per order reached.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-body text-sm text-muted-foreground">Total</span>
            <span className="font-heading text-lg font-bold text-marine">{totalDisplay}</span>
          </div>

          {orderScopedBanner}

          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            ref={continueBtnRef}
            type="button"
            onClick={goToAttendees}
            disabled={buyerTicketTypeIds.length < 1}
            className="w-full px-4 py-3 bg-marine text-white rounded-lg text-sm font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Continue
          </button>
        </>
      )}

      {step === "attendees" && (
        <>
          <h3 ref={step2HeadingRef} tabIndex={-1} className="font-heading text-base font-bold text-marine focus:outline-none">
            Who&apos;s coming?
          </h3>
          <p className="font-body text-xs text-muted-foreground">
            Every guest needs their own QR code to get in — <strong>no QR code, no
            bracelet.</strong> Add each guest’s name and email and we’ll email them their QR
            code.
          </p>

          {orderScopedBanner}

          {/* The buyer's own ticket(s) — an ordinary row in the order, not a special case. */}
          <div className="rounded-lg border border-sky/40 bg-sky/5 px-3 py-3 space-y-1">
            <p className="font-body text-xs font-semibold text-marine uppercase tracking-wide">Your ticket</p>
            <p className="font-body text-sm text-marine">{name || "You"}{email ? ` · ${email}` : ""}</p>
            <p className="font-body text-xs text-muted-foreground">
              {selectable.filter((t) => buyerTicketTypeIds.includes(t.id)).map((t) => t.title).join(", ") || "—"}
            </p>
            {fieldError(0, "name") && <p className="font-body text-xs text-red-700">{fieldError(0, "name")}</p>}
            {fieldError(0, "email") && <p className="font-body text-xs text-red-700">{fieldError(0, "email")}</p>}
            {fieldError(0, "ticketTypeIds") && (
              <p className="font-body text-xs text-red-700">{fieldError(0, "ticketTypeIds")}</p>
            )}
          </div>

          {/* Guest tickets — repeatable rows (R20). One row per person, however many types. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-body text-xs text-muted-foreground uppercase tracking-wide">Guest tickets</p>
              <button
                type="button"
                onClick={addGuest}
                disabled={atCap}
                className="font-body text-xs font-semibold text-marine underline underline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                + Add guest
              </button>
            </div>
            {guests.map((g, idx) => {
              const personIndex = idx + 1;
              const nameErr = violations.find((v) => v.personIndex === personIndex && v.field === "name")?.message;
              const emailErr = violations.find((v) => v.personIndex === personIndex && v.field === "email")?.message;
              const typesErr = violations.find(
                (v) => v.personIndex === personIndex && v.field === "ticketTypeIds"
              )?.message;
              return (
                <div key={g.key} className="rounded-lg border border-border px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-body text-xs text-muted-foreground">Guest {idx + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeGuest(g.key)}
                      aria-label={`Remove guest ${idx + 1}`}
                      className="font-body text-xs text-red-700 underline underline-offset-2 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={g.firstName}
                      onChange={(e) => setGuestField(g.key, "firstName", e.target.value)}
                      placeholder="First name"
                      aria-label={`Guest ${idx + 1} first name`}
                      className={inputClass}
                      autoComplete="off"
                    />
                    <input
                      type="text"
                      value={g.lastName}
                      onChange={(e) => setGuestField(g.key, "lastName", e.target.value)}
                      placeholder="Last name"
                      aria-label={`Guest ${idx + 1} last name`}
                      className={inputClass}
                      autoComplete="off"
                    />
                  </div>
                  {nameErr && <p className="font-body text-xs text-red-700">{nameErr}</p>}
                  <input
                    type="email"
                    value={g.email}
                    onChange={(e) => setGuestField(g.key, "email", e.target.value)}
                    placeholder="Email (for their QR code)"
                    aria-label={`Guest ${idx + 1} email`}
                    className={inputClass}
                  />
                  {emailErr && <p className="font-body text-xs text-red-700">{emailErr}</p>}
                  <div>
                    <p className="font-body text-xs text-muted-foreground mb-1">Ticket for this guest</p>
                    {ticketRadios(
                      `guest-ticket-${g.key}`,
                      g.ticketTypeIds[0],
                      (id) => selectGuestType(g.key, id),
                      (title) => (title ? `Guest ${idx + 1} ${title} ticket` : `Guest ${idx + 1} ticket`)
                    )}
                  </div>
                  {typesErr && <p className="font-body text-xs text-red-700">{typesErr}</p>}
                </div>
              );
            })}
          </div>

          {atCap && (
            <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Maximum {cap} tickets per order reached.
            </p>
          )}

          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Sticky action bar — Back + submit + running total stay reachable on mobile. */}
          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-white border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-body text-sm text-muted-foreground">Total</span>
              <span className="font-heading text-lg font-bold text-marine">{totalDisplay}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("tickets")}
                className="px-4 py-3 rounded-lg border border-border text-marine text-sm font-body font-semibold hover:bg-cream transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-3 bg-marine text-white rounded-lg text-sm font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? "Processing…" : allFree ? "Confirm registration" : "Reserve your spot"}
              </button>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
