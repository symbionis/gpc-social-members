"use client";

import { useState } from "react";
import posthog from "posthog-js";

interface Props {
  eventId: string;
  /** Active ticket types the waitlister can request (id + title only). */
  ticketTypes: { id: string; title: string }[];
  defaultName?: string;
  defaultEmail?: string;
}

const MAX_WAITLIST_QUANTITY = 10;

export default function WaitlistForm({
  eventId,
  ticketTypes,
  defaultName = "",
  defaultEmail = "",
}: Props) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    if (!ticketTypeId) {
      setError("Please choose a ticket type.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ticket_type_id: ticketTypeId,
          quantity,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not join waitlist. Please try again.");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      setSubmitting(false);
    } catch (err) {
      console.error(err);
      try {
        posthog.capture("event_waitlist_network_error", {
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
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-body text-sm text-emerald-900">
          You&apos;re on the waitlist. We&apos;ll be in touch if a ticket opens up.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
      </div>

      {ticketTypes.length > 1 && (
        <div>
          <label className="block text-xs font-body text-muted-foreground mb-1">
            Ticket type
          </label>
          <select
            required
            value={ticketTypeId}
            onChange={(e) => setTicketTypeId(e.target.value)}
            className={inputClass}
          >
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs font-body text-muted-foreground mb-1">
          Number of tickets
        </label>
        <select
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className={inputClass}
        >
          {Array.from({ length: MAX_WAITLIST_QUANTITY }, (_, i) => i + 1).map((n) => (
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
        className="w-full px-4 py-3 bg-marine text-white rounded-lg text-sm font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {submitting ? "Adding…" : "Join waitlist"}
      </button>
    </form>
  );
}
