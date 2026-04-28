"use client";

import { useState } from "react";

interface Props {
  eventId: string;
  priceMember: number;
  priceNonMember: number;
  defaultName?: string;
  defaultEmail?: string;
  showMemberRate?: boolean;
  /** When true, show only the member rate (used on the member-facing page). */
  memberOnly?: boolean;
}

const MAX_QUANTITY = 6;

export default function EventRegistrationForm({
  eventId,
  priceMember,
  priceNonMember,
  defaultName = "",
  defaultEmail = "",
  showMemberRate = true,
  memberOnly = false,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ referenceCode: string } | null>(
    null
  );

  const memberFree = priceMember === 0;
  const nonMemberFree = priceNonMember === 0;
  const allFree = memberFree && nonMemberFree;

  function priceLabel(value: number) {
    return value === 0 ? "Free" : `CHF ${value.toFixed(2)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      setError(`Quantity must be between 1 and ${MAX_QUANTITY}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), quantity }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not register. Please try again.");
        setSubmitting(false);
        return;
      }

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      if (data.success && data.reference_code) {
        setSuccess({ referenceCode: data.reference_code });
        setSubmitting(false);
        return;
      }

      setError("Unexpected response. Please try again.");
      setSubmitting(false);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="font-heading text-lg font-bold text-emerald-900 mb-1">
          You&apos;re registered.
        </h3>
        <p className="font-body text-sm text-emerald-800">
          A confirmation email is on its way. Reference{" "}
          <span className="font-mono font-semibold">{success.referenceCode}</span>.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg bg-cream/60 border border-border p-4 text-sm font-body text-marine">
        {memberOnly ? (
          memberFree ? (
            <p>This event is free for members.</p>
          ) : (
            <p>
              <span className="font-semibold">Member price:</span>{" "}
              {priceLabel(priceMember)}
            </p>
          )
        ) : showMemberRate ? (
          allFree ? (
            <p>This event is free.</p>
          ) : (
            <p>
              <span className="font-semibold">Members:</span>{" "}
              {priceLabel(priceMember)}
              {" · "}
              <span className="font-semibold">Non-members:</span>{" "}
              {priceLabel(priceNonMember)}
            </p>
          )
        ) : nonMemberFree ? (
          <p>This event is free.</p>
        ) : (
          <p>
            <span className="font-semibold">Price:</span>{" "}
            {priceLabel(priceNonMember)}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Full name
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoComplete="name"
        />
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          autoComplete="email"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Members get the member rate automatically.
        </p>
      </div>

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Number of tickets
        </label>
        <select
          required
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className={inputClass}
        >
          {Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-3 bg-marine text-white rounded-lg text-sm font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50"
      >
        {submitting ? "Processing…" : allFree ? "Confirm registration" : "Register"}
      </button>
    </form>
  );
}
