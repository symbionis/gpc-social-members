"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { formatDateTime } from "@/lib/format";

/** A checked-in attendee, most-recent first. */
interface Arrival {
  id: string;
  name: string;
  arrivedAt: string | null;
}

interface Props {
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); may be empty in local dev. */
  baseUrl: string;
  /** Path of the public check-in page, e.g. /public/events/<id>/check-in */
  checkInPath: string;
  arrivedCount: number;
  expectedCount: number;
  arrivals: Arrival[];
}

// The "run the door" surface: a live arrivals count, the kiosk link + QR, and a
// recent-arrivals feed. Mounted only while the Check-in tab is active, so the soft
// auto-refresh (router.refresh) runs only when an organizer is actually watching.
export default function EventCheckInPanel({
  baseUrl,
  checkInPath,
  arrivedCount,
  expectedCount,
  arrivals,
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
  const [refreshing, setRefreshing] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement>(null);

  // Keep arrivals fresh during a live event without a manual reload.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(id);
  }, [router]);

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

  function refreshNow() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  }

  const pct =
    expectedCount > 0 ? Math.round((arrivedCount / expectedCount) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-1">
            Door check-in
          </p>
          <h3 className="font-heading text-xl font-bold text-marine">Arrivals</h3>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
        >
          Open kiosk ↗
        </a>
      </div>

      <div className="rounded-xl border border-border bg-white p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="font-body text-sm text-muted-foreground">
            <span className="font-heading text-2xl font-bold text-marine">
              {arrivedCount}
            </span>{" "}
            / {expectedCount} arrived
          </p>
          <div className="flex items-center gap-3">
            <span className="font-body text-sm text-muted-foreground">{pct}%</span>
            <button
              type="button"
              onClick={refreshNow}
              className="text-xs font-body text-marine hover:underline cursor-pointer"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-cream overflow-hidden">
          <div
            className="h-full bg-marine transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
        <section>
          <h4 className="font-heading text-base font-bold text-marine mb-1">
            Check-in link
          </h4>
          <p className="font-body text-sm text-muted-foreground mb-3">
            Guests open this on their own phone. Print the QR for the door.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-cream/40 text-marine font-mono text-xs"
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
        <section className="flex flex-col items-center gap-2">
          <div
            ref={qrWrapRef}
            className="bg-white p-3 rounded-lg border border-border"
          >
            <QRCodeCanvas value={url} size={140} marginSize={2} />
          </div>
          <button
            type="button"
            onClick={downloadQr}
            className="text-xs font-body text-marine hover:underline cursor-pointer"
          >
            Download PNG
          </button>
        </section>
      </div>

      <section>
        <h4 className="font-heading text-base font-bold text-marine mb-3">
          Recent arrivals
        </h4>
        {arrivals.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">No arrivals yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {arrivals.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="font-body text-sm text-marine">
                  {a.name || "—"}
                </span>
                <span className="font-body text-xs text-muted-foreground">
                  {a.arrivedAt ? formatDateTime(a.arrivedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
