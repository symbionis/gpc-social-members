"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import PhoneInput from "@/components/common/PhoneInput";

export interface TicketTypeOption {
  id: string;
  title: string;
  /** Price resolved for THIS viewer's rate class; null = not open yet (not selectable). */
  price: number | null;
  /** A children's ticket — bought as a guest quantity, named without an email. */
  is_child: boolean;
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

const MAX_QUANTITY_HARD_CAP = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function priceLabel(value: number) {
  return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
}

/** A single named-attendee row rendered in step 2. */
interface GuestRow {
  /** Stable key `${ticket_type_id}#${indexWithinTypeGuests}`. */
  key: string;
  ticketTypeId: string;
  title: string;
  isChild: boolean;
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
  const selectable = useMemo(() => ticketTypes.filter((t) => t.price !== null), [ticketTypes]);
  const adultTypes = useMemo(() => selectable.filter((t) => !t.is_child), [selectable]);

  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState<string | null>(null);
  // Quantities for the WHOLE party (the buyer's own ticket included). No implicit +1.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"tickets" | "attendees">("tickets");
  // The buyer's own meal. Auto when one adult type is selected; chosen in step 2 otherwise.
  const [leadTicketTypeId, setLeadTicketTypeId] = useState("");
  // Guest name/email keyed by GuestRow.key.
  const [guests, setGuests] = useState<Record<string, { name: string; email: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ referenceCode: string } | null>(null);
  const [soldOut, setSoldOut] = useState(false);

  const step2HeadingRef = useRef<HTMLHeadingElement | null>(null);
  const continueBtnRef = useRef<HTMLButtonElement | null>(null);

  const totalQuantity = Object.values(quantities).reduce((a, b) => a + b, 0);
  const totalAmount = selectable.reduce(
    (sum, t) => sum + (t.price as number) * (quantities[t.id] ?? 0),
    0
  );
  const atCap = totalQuantity >= cap;
  const allFree = selectable.length > 0 && selectable.every((t) => t.price === 0);

  const selectedAdultTypes = useMemo(
    () => adultTypes.filter((t) => (quantities[t.id] ?? 0) > 0),
    [adultTypes, quantities]
  );
  const hasAdultSelected = selectedAdultTypes.length > 0;

  // Resolve the buyer's own meal from the basket. One selected adult type implies it;
  // 0 or 2+ adult types leave it empty so the "You" row forces an explicit pick. This
  // runs only when the basket changes, so a radio choice the user makes afterwards
  // persists (the effect doesn't clobber it).
  useEffect(() => {
    setLeadTicketTypeId(selectedAdultTypes.length === 1 ? selectedAdultTypes[0].id : "");
  }, [selectedAdultTypes]);

  // The rows to name in step 2: one per purchased ticket EXCEPT the buyer's own slot
  // (the lead is seeded server-side from leadTicketTypeId).
  const guestRows = useMemo<GuestRow[]>(() => {
    const rows: GuestRow[] = [];
    for (const t of selectable) {
      const qty = quantities[t.id] ?? 0;
      const guestSlots = qty - (t.id === leadTicketTypeId ? 1 : 0);
      for (let i = 0; i < guestSlots; i++) {
        rows.push({ key: `${t.id}#${i}`, ticketTypeId: t.id, title: t.title, isChild: t.is_child });
      }
    }
    return rows;
  }, [selectable, quantities, leadTicketTypeId]);

  function setQty(id: string, q: number) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, q) }));
  }

  function setGuestField(key: string, field: "name" | "email", value: string) {
    setGuests((prev) => {
      const cur = prev[key] ?? { name: "", email: "" };
      return { ...prev, [key]: { ...cur, [field]: value } };
    });
    if (rowErrors[key]) setRowErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function goToAttendees() {
    setError(null);
    setStep("attendees");
  }

  // Move focus to the step-2 heading when the naming step opens (perceivable for
  // keyboard/screen-reader users, since this is a view swap with no route change).
  useEffect(() => {
    if (step === "attendees") step2HeadingRef.current?.focus();
    else continueBtnRef.current?.focus();
  }, [step]);

  function validateGuests(): {
    attendees: { ticket_type_id: string; name: string; email?: string }[];
    ok: boolean;
  } {
    const errs: Record<string, string> = {};
    const attendees: { ticket_type_id: string; name: string; email?: string }[] = [];
    const seenEmails = new Set<string>();
    if (email.trim()) seenEmails.add(email.trim().toLowerCase());

    for (const row of guestRows) {
      const g = guests[row.key];
      const nm = g?.name?.trim() ?? "";
      if (!nm) continue; // blank rows are allowed — left for the self-reg link
      if (row.isChild) {
        attendees.push({ ticket_type_id: row.ticketTypeId, name: nm });
        continue;
      }
      const e = (g?.email ?? "").trim().toLowerCase();
      if (!e || !EMAIL_RE.test(e)) {
        errs[row.key] = "Add a valid email for this guest.";
        continue;
      }
      if (seenEmails.has(e)) {
        errs[row.key] = "Each guest needs a different email.";
        continue;
      }
      seenEmails.add(e);
      attendees.push({ ticket_type_id: row.ticketTypeId, name: nm, email: e });
    }
    setRowErrors(errs);
    return { attendees, ok: Object.keys(errs).length === 0 };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (!email.trim()) return setError("Please enter your email.");
    if (!hasAdultSelected) return setError("Add at least one adult ticket.");
    if (!leadTicketTypeId) return setError("Please choose which ticket is yours.");
    if (totalQuantity > cap) return setError(`A maximum of ${cap} tickets can be booked at once.`);

    const { attendees, ok } = validateGuests();
    if (!ok) return setError("Please fix the highlighted guest details.");

    const items = selectable
      .filter((t) => (quantities[t.id] ?? 0) > 0)
      .map((t) => ({ ticket_type_id: t.id, quantity: quantities[t.id] }));

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(phone ? { phone } : {}),
          items,
          leadTicketTypeId,
          ...(attendees.length ? { attendees } : {}),
          ...(code ? { code } : {}),
        }),
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

  const totalDisplay = totalQuantity > 0 && totalAmount === 0 ? "Free" : `CHF ${totalAmount.toFixed(2)}`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-live="polite">
      <p className="font-body text-xs text-muted-foreground uppercase tracking-wide">
        {step === "tickets" ? "Step 1 of 2 · Tickets" : "Step 2 of 2 · Who's coming"}
      </p>

      {step === "tickets" && (
        <>
          <div>
            <label htmlFor="reg-name" className="block text-xs font-body text-muted-foreground mb-1">Full name</label>
            <input id="reg-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" />
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-xs font-body text-muted-foreground mb-1">Email</label>
            <input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
          </div>

          <div>
            <label htmlFor="reg-phone" className="block text-xs font-body text-muted-foreground mb-1">Phone</label>
            <PhoneInput id="reg-phone" defaultValue={null} onChange={setPhone} />
          </div>

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

          {totalQuantity > 0 && !hasAdultSelected && (
            <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Add at least one adult ticket — the person booking attends.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-body text-sm text-muted-foreground">Total</span>
            <span className="font-heading text-lg font-bold text-marine">{totalDisplay}</span>
          </div>

          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            ref={continueBtnRef}
            type="button"
            onClick={goToAttendees}
            disabled={totalQuantity < 1 || !hasAdultSelected}
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
            bracelet.</strong> Add each guest’s name and email so you can send them their QR
            from your booking page. Leave a guest blank and they’ll get a link to register
            themselves.
          </p>

          {/* The buyer's own ticket. */}
          <div className="rounded-lg border border-sky/40 bg-sky/5 px-3 py-3 space-y-2">
            <p className="font-body text-xs font-semibold text-marine uppercase tracking-wide">Your ticket</p>
            <p className="font-body text-sm text-marine">{name || "You"}{email ? ` · ${email}` : ""}</p>
            {selectedAdultTypes.length > 1 ? (
              <fieldset className="space-y-1">
                <legend className="font-body text-xs text-muted-foreground mb-1">Which ticket is yours?</legend>
                {selectedAdultTypes.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 font-body text-sm text-marine cursor-pointer">
                    <input
                      type="radio"
                      name="lead-ticket"
                      value={t.id}
                      checked={leadTicketTypeId === t.id}
                      onChange={() => setLeadTicketTypeId(t.id)}
                    />
                    {t.title} — {priceLabel(t.price as number)}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="font-body text-xs text-muted-foreground">
                {selectedAdultTypes[0]?.title}
                {selectedAdultTypes[0] ? ` — ${priceLabel(selectedAdultTypes[0].price as number)}` : ""}
              </p>
            )}
          </div>

          {/* Guest tickets, grouped by meal type. */}
          {guestRows.length > 0 && (
            <div className="space-y-3">
              <p className="font-body text-xs text-muted-foreground uppercase tracking-wide">Guest tickets</p>
              {guestRows.map((row, idx) => {
                const g = guests[row.key] ?? { name: "", email: "" };
                const err = rowErrors[row.key];
                const nameId = `guest-${row.key}-name`;
                const emailId = `guest-${row.key}-email`;
                return (
                  <div key={row.key} className="rounded-lg border border-border px-3 py-3 space-y-2">
                    <p className="font-body text-xs text-muted-foreground">
                      Guest {idx + 1} · {row.title}
                    </p>
                    <input
                      id={nameId}
                      type="text"
                      value={g.name}
                      onChange={(e) => setGuestField(row.key, "name", e.target.value)}
                      placeholder="Name"
                      aria-label={`Guest ${idx + 1} name — ${row.title}`}
                      className={inputClass}
                    />
                    {!row.isChild && (
                      <input
                        type="email"
                        value={g.email}
                        onChange={(e) => setGuestField(row.key, "email", e.target.value)}
                        placeholder="Email (for their QR code)"
                        aria-label={`Guest ${idx + 1} email — ${row.title}`}
                        aria-describedby={err ? `${emailId}-err` : undefined}
                        className={inputClass}
                      />
                    )}
                    {err && (
                      <p id={`${emailId}-err`} className="font-body text-xs text-red-700">{err}</p>
                    )}
                  </div>
                );
              })}
            </div>
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
                disabled={submitting || !leadTicketTypeId}
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
