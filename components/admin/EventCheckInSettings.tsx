"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

interface Props {
  eventId: string;
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); may be empty in local dev. */
  baseUrl: string;
  /** Path of the public check-in page, e.g. /public/events/<id>/check-in */
  checkInPath: string;
  strictCheckin: boolean;
}

export default function EventCheckInSettings({
  eventId,
  baseUrl,
  checkInPath,
  strictCheckin,
}: Props) {
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
  const [strict, setStrict] = useState(strictCheckin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrWrapRef = useRef<HTMLDivElement>(null);

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

  async function toggleStrict() {
    const next = !strict;
    setStrict(next);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strict_checkin: next }),
      });
      if (!res.ok) {
        setStrict(!next);
        setError("Could not update strict check-in. Try again.");
      }
    } catch {
      setStrict(!next);
      setError("Network error. Could not update strict check-in.");
    } finally {
      setSaving(false);
    }
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

      <section>
        <h3 className="font-heading text-lg font-bold text-marine mb-1">
          Strict check-in
        </h3>
        <p className="font-body text-sm text-muted-foreground mb-3">
          When on, only people matched to a registration or an active membership
          can check in. Invited guests are sent to the welcome desk. When off,
          invited guests check in by naming who invited them.
        </p>
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={strict}
            disabled={saving}
            onChange={toggleStrict}
            className="h-5 w-5 accent-marine cursor-pointer disabled:opacity-50"
          />
          <span className="text-sm font-body text-marine">
            {strict ? "Strict check-in is ON" : "Strict check-in is OFF"}
          </span>
        </label>
      </section>
    </div>
  );
}
