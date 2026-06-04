"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  eventId: string;
  /** Current ticket cap (events.seat_cap); null = unlimited. */
  seatCap: number | null;
  /** Tickets already taken (paid + free) — used for the overbooked warning. */
  seatsUsed: number;
}

// Capacity settings for an event. The door check-in link + QR live on the Check-in
// tab (EventCheckInPanel), alongside the live arrivals view.
export default function EventCheckInSettings({
  eventId,
  seatCap,
  seatsUsed,
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
    </div>
  );
}
