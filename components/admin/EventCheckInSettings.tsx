"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_BOOKING_LIMIT, ABSOLUTE_MAX_TICKETS } from "@/lib/events/booking-limits";

interface Props {
  eventId: string;
  /** Current ticket cap (events.seat_cap); null = unlimited. */
  seatCap: number | null;
  /** Tickets already taken (paid + free) — used for the overbooked warning. */
  seatsUsed: number;
  /** Current per-rate-class booking limits; null = use the app default (10). */
  maxTicketsMember: number | null;
  maxTicketsInvite: number | null;
  maxTicketsNonMember: number | null;
}

type LimitField = "max_tickets_member" | "max_tickets_invite" | "max_tickets_non_member";

// Capacity settings for an event. The door check-in link + QR live on the Check-in
// tab (EventCheckInPanel), alongside the live arrivals view.
export default function EventCheckInSettings({
  eventId,
  seatCap,
  seatsUsed,
  maxTicketsMember,
  maxTicketsInvite,
  maxTicketsNonMember,
}: Props) {
  const router = useRouter();

  // Ticket cap (events.seat_cap). Empty string = unlimited.
  const [cap, setCap] = useState(seatCap === null ? "" : String(seatCap));
  const [capSaving, setCapSaving] = useState(false);
  const [capSaved, setCapSaved] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);

  const savedCap = seatCap === null ? "" : String(seatCap);
  const capChanged = cap.trim() !== savedCap;
  const capParsed = cap.trim() === "" ? null : Number(cap);
  const capInvalid =
    capParsed !== null && (!Number.isInteger(capParsed) || capParsed <= 0);
  const capBelowUsage =
    capParsed !== null && !capInvalid && capParsed < seatsUsed;

  async function saveCap() {
    if (capInvalid) {
      setCapError("Ticket cap must be a positive whole number, or blank for unlimited.");
      return;
    }
    setCapError(null);
    setCapSaved(false);
    setCapSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seat_cap: capParsed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCapError(data.error || "Could not update ticket cap. Try again.");
        return;
      }
      setCapSaved(true);
      router.refresh();
    } catch {
      setCapError("Network error. Could not update ticket cap.");
    } finally {
      setCapSaving(false);
    }
  }

  // Per-rate-class tickets-per-booking limits. Empty string = use the app default.
  const savedLimits: Record<LimitField, number | null> = {
    max_tickets_member: maxTicketsMember,
    max_tickets_invite: maxTicketsInvite,
    max_tickets_non_member: maxTicketsNonMember,
  };
  const toStr = (n: number | null) => (n === null ? "" : String(n));
  const [limits, setLimits] = useState<Record<LimitField, string>>({
    max_tickets_member: toStr(maxTicketsMember),
    max_tickets_invite: toStr(maxTicketsInvite),
    max_tickets_non_member: toStr(maxTicketsNonMember),
  });
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsSaved, setLimitsSaved] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  const limitFields: { field: LimitField; label: string }[] = [
    { field: "max_tickets_member", label: "Members" },
    { field: "max_tickets_invite", label: "Invited guests" },
    { field: "max_tickets_non_member", label: "Public" },
  ];
  const limitsChanged = limitFields.some(
    ({ field }) => limits[field].trim() !== toStr(savedLimits[field])
  );
  function limitInvalid(raw: string): boolean {
    if (raw.trim() === "") return false;
    const n = Number(raw);
    return !Number.isInteger(n) || n < 1 || n > ABSOLUTE_MAX_TICKETS;
  }
  const anyLimitInvalid = limitFields.some(({ field }) => limitInvalid(limits[field]));

  async function saveLimits() {
    if (anyLimitInvalid) {
      setLimitsError(`Ticket limits must be a whole number from 1 to ${ABSOLUTE_MAX_TICKETS}, or blank for the default.`);
      return;
    }
    setLimitsError(null);
    setLimitsSaved(false);
    setLimitsSaving(true);
    try {
      const body: Partial<Record<LimitField, number | null>> = {};
      for (const { field } of limitFields) {
        const raw = limits[field].trim();
        body[field] = raw === "" ? null : Number(raw);
      }
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLimitsError(data.error || "Could not update ticket limits. Try again.");
        return;
      }
      setLimitsSaved(true);
      router.refresh();
    } catch {
      setLimitsError("Network error. Could not update ticket limits.");
    } finally {
      setLimitsSaving(false);
    }
  }

  return (
    <div className="space-y-8 max-w-xl">
      <section>
        <h3 className="font-heading text-lg font-bold text-marine mb-1">
          Ticket cap
        </h3>
        <p className="font-body text-sm text-muted-foreground mb-3">
          Limit how many tickets can be sold. Counts paid + free tickets (sum of
          ticket quantity); pending checkouts don&apos;t count. Leave blank for
          unlimited.
        </p>
        <div className="flex gap-2 items-start">
          <input
            type="number"
            min="1"
            step="1"
            value={cap}
            onChange={(e) => {
              setCap(e.target.value);
              setCapSaved(false);
              setCapError(null);
            }}
            className="w-44 px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            placeholder="Unlimited"
          />
          <button
            type="button"
            onClick={saveCap}
            disabled={capSaving || capInvalid || !capChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {capSaving ? "Saving…" : "Save"}
          </button>
          {capSaved && !capChanged && (
            <span className="text-sm font-body text-emerald-700 self-center">
              Saved
            </span>
          )}
        </div>
        {seatsUsed > 0 && (
          <p className="text-xs font-body text-muted-foreground mt-2">
            Current usage: {seatsUsed} ticket{seatsUsed === 1 ? "" : "s"}.
          </p>
        )}
        {capBelowUsage && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2">
            Cap is below current usage of {seatsUsed} ticket
            {seatsUsed === 1 ? "" : "s"}. Saving will leave the event overbooked.
          </p>
        )}
        {capError && (
          <p className="text-xs text-red-700 mt-2">{capError}</p>
        )}
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-marine mb-1">
          Tickets per booking
        </h3>
        <p className="font-body text-sm text-muted-foreground mb-3">
          Limit how many tickets one booking can hold, set separately for members, invited
          guests, and the public. Blank uses the default of {DEFAULT_BOOKING_LIMIT}. The
          invited-guest limit also applies to later top-ups on the same booking — a member
          or public booking is only bound at checkout.
        </p>
        <div className="space-y-2">
          {limitFields.map(({ field, label }) => (
            <div key={field} className="flex items-center gap-3">
              <span className="flex-1 font-body text-sm text-marine">{label}</span>
              <input
                type="number"
                min="1"
                max={ABSOLUTE_MAX_TICKETS}
                step="1"
                value={limits[field]}
                onChange={(e) => {
                  setLimits((prev) => ({ ...prev, [field]: e.target.value }));
                  setLimitsSaved(false);
                  setLimitsError(null);
                }}
                className="w-32 px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
                placeholder={String(DEFAULT_BOOKING_LIMIT)}
                aria-label={`${label} ticket limit`}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-center mt-3">
          <button
            type="button"
            onClick={saveLimits}
            disabled={limitsSaving || anyLimitInvalid || !limitsChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {limitsSaving ? "Saving…" : "Save"}
          </button>
          {limitsSaved && !limitsChanged && (
            <span className="text-sm font-body text-emerald-700">Saved</span>
          )}
        </div>
        {limitsError && <p className="text-xs text-red-700 mt-2">{limitsError}</p>}
      </section>
    </div>
  );
}
