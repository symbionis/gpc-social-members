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

/** Shared PATCH-and-refresh mechanics for one settings field/group on this event: submits
 *  the body, tracks saving/saved/error, and refreshes the page on success. The caller owns
 *  its own value state and validity check — those differ per field (a single ranged number
 *  vs. a record of them) — this hook only owns what was identical between them. */
function usePatchSettings(eventId: string, noun: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not update ${noun}. Try again.`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(`Network error. Could not update ${noun}.`);
    } finally {
      setSaving(false);
    }
  }

  return { saving, saved, error, setSaved, setError, save };
}

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
  // Ticket cap (events.seat_cap). Empty string = unlimited.
  const [cap, setCap] = useState(seatCap === null ? "" : String(seatCap));
  const capPatch = usePatchSettings(eventId, "ticket cap");

  const savedCap = seatCap === null ? "" : String(seatCap);
  const capChanged = cap.trim() !== savedCap;
  const capParsed = cap.trim() === "" ? null : Number(cap);
  const capInvalid =
    capParsed !== null && (!Number.isInteger(capParsed) || capParsed <= 0);
  const capBelowUsage =
    capParsed !== null && !capInvalid && capParsed < seatsUsed;

  async function saveCap() {
    if (capInvalid) {
      capPatch.setError("Ticket cap must be a positive whole number, or blank for unlimited.");
      return;
    }
    await capPatch.save({ seat_cap: capParsed });
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
  const limitsPatch = usePatchSettings(eventId, "ticket limits");

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
      limitsPatch.setError(
        `Ticket limits must be a whole number from 1 to ${ABSOLUTE_MAX_TICKETS}, or blank for the default.`
      );
      return;
    }
    const body: Partial<Record<LimitField, number | null>> = {};
    for (const { field } of limitFields) {
      const raw = limits[field].trim();
      body[field] = raw === "" ? null : Number(raw);
    }
    await limitsPatch.save(body);
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
              capPatch.setSaved(false);
              capPatch.setError(null);
            }}
            className="w-44 px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            placeholder="Unlimited"
          />
          <button
            type="button"
            onClick={saveCap}
            disabled={capPatch.saving || capInvalid || !capChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {capPatch.saving ? "Saving…" : "Save"}
          </button>
          {capPatch.saved && !capChanged && (
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
        {capPatch.error && (
          <p className="text-xs text-red-700 mt-2">{capPatch.error}</p>
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
                  limitsPatch.setSaved(false);
                  limitsPatch.setError(null);
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
            disabled={limitsPatch.saving || anyLimitInvalid || !limitsChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {limitsPatch.saving ? "Saving…" : "Save"}
          </button>
          {limitsPatch.saved && !limitsChanged && (
            <span className="text-sm font-body text-emerald-700">Saved</span>
          )}
        </div>
        {limitsPatch.error && <p className="text-xs text-red-700 mt-2">{limitsPatch.error}</p>}
      </section>
    </div>
  );
}
