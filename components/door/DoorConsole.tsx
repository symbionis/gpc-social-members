"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { formatDateTime } from "@/lib/format";
import PhoneInput from "@/components/common/PhoneInput";

interface DoorSlot {
  attendeeId: string | null;
  name: string;
  email: string;
  phone: string;
  ticketTypeId: string | null;
  ticketTypeTitle: string;
  isChild: boolean;
  isLead: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
}

interface DoorParty {
  registrationId: string;
  referenceCode: string | null;
  leadName: string;
  quantity: number;
  claimedCount: number;
  remaining: number;
  complete: boolean;
  selfRegToken: string | null;
  slots: DoorSlot[];
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

const searchInputClass =
  "w-full px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";
const fieldClass =
  "w-full px-3 py-2.5 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:bg-cream disabled:text-marine/60 disabled:cursor-not-allowed disabled:border-border";

function partyMatches(p: DoorParty, q: string): boolean {
  if (!q) return true;
  const hay = [
    p.leadName,
    p.referenceCode ?? "",
    ...p.slots.flatMap((s) => [s.name, s.email, s.phone]),
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

  // Keep the roster + arrivals current during the event without a manual reload.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [router]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => parties.filter((p) => partyMatches(p, q)), [parties, q]);

  function toggleQr(id: string) {
    setShownQr((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pct = expectedCount > 0 ? Math.round((arrivedCount / expectedCount) * 100) : 0;
  const preRegisteredCount = parties.reduce((s, p) => s + p.claimedCount, 0);

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
          Pre-registered{preRegisteredCount > 0 ? ` (${preRegisteredCount})` : ""}
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
            className={searchInputClass}
            autoComplete="off"
          />

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
                      <div className="min-w-0">
                        <h2 className="font-heading text-xl font-bold text-marine">
                          {p.leadName || "—"}
                        </h2>
                        {p.referenceCode && (
                          <p className="font-mono text-xs text-marine/45">{p.referenceCode}</p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 px-3 py-1 rounded-full text-sm font-body font-semibold ${
                          p.remaining > 0
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {p.claimedCount} / {p.quantity} pre-registered
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {p.slots.map((slot, i) => (
                        <SlotRow
                          key={slot.attendeeId ?? `open-${slot.ticketTypeId}-${i}`}
                          eventId={eventId}
                          registrationId={p.registrationId}
                          slot={slot}
                          onSaved={() => router.refresh()}
                        />
                      ))}
                    </div>

                    {p.remaining === 0 ? (
                      <p className="mt-4 font-body text-sm text-marine/60">
                        This party is full — everyone is pre-registered.
                      </p>
                    ) : url ? (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => toggleQr(p.registrationId)}
                          className="w-full px-4 py-4 rounded-xl bg-marine text-white font-body font-semibold text-lg hover:bg-marine-light transition-colors cursor-pointer"
                        >
                          {showQr
                            ? "Hide QR"
                            : `Show pre-registration QR (${p.remaining} ${p.remaining === 1 ? "spot" : "spots"} left)`}
                        </button>
                        {showQr && (
                          <div className="mt-3 flex flex-col items-center gap-2">
                            <div className="bg-white p-3 rounded-lg border border-border">
                              <QRCodeCanvas value={url} size={200} marginSize={2} />
                            </div>
                            <p className="font-body text-sm text-marine/60 text-center">
                              Have the guest scan this to pre-register on their own
                              phone, then check in at the kiosk.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="mt-4 font-body text-sm text-amber-700">
                        {p.remaining} {p.remaining === 1 ? "spot" : "spots"} open, but
                        this booking has no pre-registration link (it predates the
                        feature). Fill the details above or use the welcome desk.
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

function SlotRow({
  eventId,
  registrationId,
  slot,
  onSaved,
}: {
  eventId: string;
  registrationId: string;
  slot: DoorSlot;
  onSaved: () => void;
}) {
  const [name, setName] = useState(slot.name);
  const [email, setEmail] = useState(slot.email);
  const [phone, setPhone] = useState<string | null>(slot.phone || null);
  const [saving, setSaving] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // New open slots are editable immediately; claimed (live) rows start locked.
  const [editing, setEditing] = useState(slot.attendeeId === null);

  const isOpen = slot.attendeeId === null;
  const locked = !editing;
  const dirty = isOpen
    ? name.trim() !== ""
    : name !== slot.name || email !== slot.email || (phone ?? "") !== slot.phone;

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (!slot.isChild && !email.trim() && !phone) {
      return setError("Add an email or phone, or use the QR code below.");
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/door/${eventId}/save-attendee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendeeId: slot.attendeeId ?? undefined,
          registrationId,
          ticketTypeId: slot.ticketTypeId ?? undefined,
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone ?? undefined,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      onSaved();
      if (!isOpen) setEditing(false);
    } catch (err) {
      console.error("[door/save-attendee] request failed", err);
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Timed out — check the connection and try again."
          : "Could not save. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function checkInChild() {
    setError(null);
    setCheckingIn(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeIds: [slot.attendeeId] }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not check in.");
        return;
      }
      // The route silently skips ids that are already arrived or no longer on the
      // list, returning checkedIn: 0 — don't flash a false success in that case.
      if (!data.checkedIn) {
        setError("Already checked in, or no longer on the list.");
        return;
      }
      onSaved();
    } catch (err) {
      console.error("[door/check-in-children] request failed", err);
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Timed out — check the connection and try again."
          : "Could not check in. Try again."
      );
    } finally {
      setCheckingIn(false);
    }
  }

  return (
    <div
      className={`rounded-xl border p-3 ${
        isOpen ? "border-dashed border-marine/30 bg-cream/30" : "border-border bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 min-w-0 flex-wrap">
          {slot.ticketTypeTitle && (
            <span className="font-body text-base font-semibold text-marine">
              {slot.ticketTypeTitle}
            </span>
          )}
          {slot.isLead && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-marine/10 text-marine">
              lead
            </span>
          )}
          {slot.isChild && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-purple-100 text-purple-800">
              child
            </span>
          )}
          {slot.checkedIn && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-emerald-100 text-emerald-800">
              arrived
            </span>
          )}
        </span>
        {slot.isChild && !slot.checkedIn && !isOpen && (
          <button
            type="button"
            onClick={checkInChild}
            disabled={checkingIn}
            className="shrink-0 px-3 py-1 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-body hover:bg-emerald-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {checkingIn ? "…" : "Arrived"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={slot.isChild ? "Child's name" : "Full name"}
          className={fieldClass}
          autoComplete="off"
          disabled={locked}
        />
        {!slot.isChild && (
          <>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className={fieldClass}
              autoComplete="off"
              disabled={locked}
            />
            <PhoneInput
              key={editing ? "edit" : "view"}
              defaultValue={slot.phone || null}
              onChange={setPhone}
              disabled={locked}
            />
          </>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {locked ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 w-full px-3 py-2.5 rounded-lg border border-marine/30 text-marine font-body font-semibold text-sm hover:bg-marine/5 transition-colors cursor-pointer"
        >
          Edit details
        </button>
      ) : (
        <div className="mt-2 flex gap-2">
          {dirty && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 px-3 py-2.5 rounded-lg bg-marine text-white font-body font-semibold text-sm hover:bg-marine-light transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? "Saving…" : isOpen ? "Save guest" : "Save changes"}
            </button>
          )}
          {!isOpen && (
            <button
              type="button"
              onClick={() => {
                setName(slot.name);
                setEmail(slot.email);
                setPhone(slot.phone || null);
                setError(null);
                setEditing(false);
              }}
              className="flex-1 px-3 py-2.5 rounded-lg border border-marine/30 text-marine font-body font-semibold text-sm hover:bg-marine/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
