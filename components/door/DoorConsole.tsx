"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { formatDateTime } from "@/lib/format";
import type { PartyGuest } from "@/lib/events/roster-fill";

interface DoorParty {
  registrationId: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
  quantity: number;
  claimedCount: number;
  remaining: number;
  complete: boolean;
  selfRegToken: string | null;
  guests: PartyGuest[];
}

interface Arrival {
  id: string;
  name: string;
  arrivedAt: string;
}

interface Props {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  baseUrl: string;
  parties: DoorParty[];
  arrivals: Arrival[];
  arrivedCount: number;
  expectedCount: number;
}

const inputClass =
  "w-full px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

function partyMatches(p: DoorParty, q: string): boolean {
  if (!q) return true;
  const hay = [
    p.leadName,
    p.leadEmail,
    p.leadPhone,
    ...p.guests.flatMap((g) => [g.name, g.email, g.phone_e164]),
  ];
  return hay.some((s) => s && s.toLowerCase().includes(q));
}

export default function DoorConsole({
  eventId,
  eventTitle,
  eventDate,
  baseUrl,
  parties,
  arrivals,
  arrivedCount,
  expectedCount,
}: Props) {
  const router = useRouter();

  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);

  const [tab, setTab] = useState<"registered" | "checkedin">("registered");
  const [query, setQuery] = useState("");
  const [shownQr, setShownQr] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Keep the roster + arrivals current during the event without a manual reload.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [router]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => parties.filter((p) => partyMatches(p, q)),
    [parties, q]
  );

  function toggleQr(id: string) {
    setShownQr((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function removeGuest(attendeeId: string, name: string) {
    if (!window.confirm(`Remove ${name || "this guest"} and free their slot?`)) return;
    setError(null);
    setRemoving((prev) => new Set(prev).add(attendeeId));
    try {
      const res = await fetch(`/api/public/door/${eventId}/free-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not remove the guest.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not remove the guest.");
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(attendeeId);
        return next;
      });
    }
  }

  const pct = expectedCount > 0 ? Math.round((arrivedCount / expectedCount) * 100) : 0;

  const tabClass = (active: boolean) =>
    `px-5 py-3 text-base font-body transition-colors cursor-pointer ${
      active
        ? "text-marine border-b-2 border-marine -mb-px font-semibold"
        : "text-marine/50 hover:text-marine"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-1">
          Door check-in
        </p>
        <h1 className="font-heading text-2xl font-bold text-marine leading-tight">
          {eventTitle}
        </h1>
        {eventDate && <p className="font-body text-base text-marine/60">{eventDate}</p>}
      </div>

      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setTab("registered")}
          className={tabClass(tab === "registered")}
        >
          Registered{parties.length > 0 ? ` (${parties.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("checkedin")}
          className={tabClass(tab === "checkedin")}
        >
          Checked in{arrivedCount > 0 ? ` (${arrivedCount})` : ""}
        </button>
      </div>

      {tab === "registered" && (
        <div className="space-y-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a guest or party"
            className={inputClass}
            autoComplete="off"
          />

      {error && (
        <p className="text-base font-body text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {visible.length === 0 ? (
          <p className="font-body text-base text-marine/70 bg-white border border-border rounded-xl px-4 py-4">
            {parties.length === 0
              ? "No parties on the roster yet."
              : "No match. Ask the guest which name the booking is under, or send them to the welcome desk."}
          </p>
        ) : (
          visible.map((p) => {
            const url =
              p.selfRegToken && origin
                ? `${origin}/public/registrations/${p.selfRegToken}`
                : "";
            const showQr = shownQr.has(p.registrationId);
            return (
              <div
                key={p.registrationId}
                className="rounded-2xl border border-border bg-white p-5 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-heading text-xl font-bold text-marine">
                    {p.leadName || "—"}
                  </h2>
                  <span
                    className={`shrink-0 px-3 py-1 rounded-full text-sm font-body font-semibold ${
                      p.remaining > 0
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {p.claimedCount} / {p.quantity} registered
                  </span>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {p.guests.length === 0 && (
                    <li className="font-body text-sm text-marine/60">
                      {p.claimedCount === 0
                        ? "No one has registered yet."
                        : "Only the lead has registered so far."}
                    </li>
                  )}
                  {p.guests.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-2 font-body text-base"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-marine truncate">{g.name || "—"}</span>
                        {g.waiverSigned ? (
                          <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700">
                            waiver
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-800">
                            no waiver
                          </span>
                        )}
                        {g.checkedIn && (
                          <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-800">
                            arrived
                          </span>
                        )}
                      </span>
                      {!g.checkedIn && (
                        <button
                          type="button"
                          onClick={() => removeGuest(g.id, g.name)}
                          disabled={removing.has(g.id)}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm font-body hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {removing.has(g.id) ? "…" : "Remove"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {p.remaining === 0 ? (
                  <p className="mt-4 font-body text-sm text-marine/60">
                    This party is full — everyone is registered.
                  </p>
                ) : url ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => toggleQr(p.registrationId)}
                      className="w-full px-4 py-4 rounded-xl border-2 border-marine/30 bg-white text-marine font-body font-semibold text-lg hover:bg-marine/5 transition-colors cursor-pointer"
                    >
                      {showQr
                        ? "Hide QR"
                        : `Show registration QR (${p.remaining} ${p.remaining === 1 ? "spot" : "spots"} left)`}
                    </button>
                    {showQr && (
                      <div className="mt-3 flex flex-col items-center gap-2">
                        <div className="bg-white p-3 rounded-lg border border-border">
                          <QRCodeCanvas value={url} size={200} marginSize={2} />
                        </div>
                        <p className="font-body text-sm text-marine/60 text-center">
                          Have the guest scan this to register on their own phone,
                          then check in at the kiosk.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 font-body text-sm text-amber-700">
                    {p.remaining} {p.remaining === 1 ? "spot" : "spots"} open, but
                    this booking has no self-registration link (it predates the
                    feature). Add the guest at the welcome desk.
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
        </div>
      )}

      {tab === "checkedin" && (
        <div className="rounded-xl border border-border bg-white p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <p className="font-body text-sm text-marine/70">
            <span className="font-heading text-2xl font-bold text-marine">
              {arrivedCount}
            </span>{" "}
            / {expectedCount} arrived
          </p>
          <div className="flex items-center gap-3">
            <span className="font-body text-sm text-marine/60">{pct}%</span>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-xs font-body text-marine hover:underline cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-cream overflow-hidden">
          <div className="h-full bg-marine transition-all" style={{ width: `${pct}%` }} />
        </div>

        {arrivals.length > 0 && (
          <ul className="mt-4 divide-y divide-border">
            {arrivals.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-body text-sm text-marine">{a.name || "—"}</span>
                <span className="font-body text-xs text-marine/50">
                  {formatDateTime(a.arrivedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
