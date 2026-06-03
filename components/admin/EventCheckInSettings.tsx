"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";

interface Props {
  eventId: string;
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); may be empty in local dev. */
  baseUrl: string;
  /** Path of the public check-in page, e.g. /public/events/<id>/check-in */
  checkInPath: string;
  /** Current ticket cap (events.seat_cap); null = unlimited. */
  seatCap: number | null;
  /** Tickets already taken (paid + free) — used for the overbooked warning. */
  seatsUsed: number;
}

export default function EventCheckInSettings({
  eventId,
  baseUrl,
  checkInPath,
  seatCap,
  seatsUsed,
}: Props) {
  const router = useRouter();
  // Initial value matches on server and client (env is build-time stable). If no
  // base URL is configured, fall back to the live origin after mount.
  const [url, setUrl] = useState(baseUrl ? `${baseUrl}${checkInPath}` : checkInPath);
  useEffect(() => {
    if (!/^https?:\/\//.test(url) && typeof window !== "undefined") {
      setUrl(`${window.location.origin}${checkInPath}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrWrapRef = useRef<HTMLDivElement>(null);

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

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the link and copy manually.");
    }
  }

  function downloadQr() {
    const canvas = qrWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "check-in-qr.png";
    link.click();
  }

  return (
    <div className="space-y-8 max-w-xl">
      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

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
          Check-in link
        </h3>
        <p className="font-body text-sm text-muted-foreground mb-3">
          Guests open this on their own phone to check in. Print the QR poster for
          the door.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-cream/40 text-marine font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={copyUrl}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors cursor-pointer"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="font-heading text-lg font-bold text-marine mb-3">
          QR poster
        </h3>
        <div className="flex items-center gap-5">
          <div ref={qrWrapRef} className="bg-white p-3 rounded-lg border border-border">
            <QRCodeCanvas value={url} size={180} marginSize={2} />
          </div>
          <button
            type="button"
            onClick={downloadQr}
            className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body hover:bg-cream transition-colors cursor-pointer"
          >
            Download PNG
          </button>
        </div>
      </section>
    </div>
  );
}
