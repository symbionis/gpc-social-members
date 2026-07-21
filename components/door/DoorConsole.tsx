"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import PhoneInput from "@/components/common/PhoneInput";
import WaiverText from "@/components/events/WaiverText";
import type { WaiverLanguage } from "@/lib/events/waiver";
// The shapes this console renders are the shapes buildDoorRoster produces — imported
// from the module that produces them rather than restated here, so the two cannot
// drift. Type-only, so lib/events/door-access's admin Supabase client is never pulled
// into the client bundle.
import type {
  DoorSlot,
  DoorParty,
  DoorArrival,
  DoorNotArrived,
} from "@/lib/events/door-access";

/**
 * What the arrivals list renders: a ticket row (contact fields ride along because the
 * arrivals search matches on them exactly as the Pre-registered tab's does (R15) — they
 * are never displayed), plus a time when it has arrived. DoorNotArrived is the nullable-
 * name variant: null is an unnamed open slot, rendered as "Open slot" (KTD8).
 */
type ListRow = DoorNotArrived & { arrivedAt?: string };

interface Props {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  parties: DoorParty[];
  arrivals: DoorArrival[];
  notArrived: DoorNotArrived[];
  arrivedCount: number;
  expectedCount: number;
  /** Literally notArrived.length, so the count and the list it labels always agree. */
  outstandingCount: number;
  /**
   * expected − arrived − outstanding: seats sold that have no ticket row in either feed,
   * so those guests cannot be found or checked in from this console. Zero for a healthy
   * event; non-zero is surfaced as a warning so the door sees the gap instead of turning
   * a real ticket-holder away. Can be negative (more live rows than seats sold).
   */
  unaccountedCount: number;
}

const searchInputClass =
  "w-full px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";
const fieldClass =
  "w-full px-4 py-3 rounded-lg border-2 border-marine/20 bg-white text-marine font-body text-base focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:bg-cream disabled:text-marine/60 disabled:cursor-not-allowed disabled:border-border";

/**
 * The one matcher behind every search box on this screen (R15). The Pre-registered tab
 * and both arrivals views feed it their own fields, so what a volunteer can search for
 * cannot drift between tabs. `q` is already trimmed + lowercased.
 */
function matchesQuery(fields: (string | null)[], q: string): boolean {
  if (!q) return true;
  return fields.some((s) => s && s.toLowerCase().includes(q));
}

function partyMatches(p: DoorParty, q: string): boolean {
  return matchesQuery(
    [p.leadName, p.referenceCode, ...p.slots.flatMap((s) => [s.name, s.email, s.phone])],
    q
  );
}

function ticketMatches(t: DoorNotArrived, q: string): boolean {
  return matchesQuery([t.name, t.partyName, t.referenceCode, t.email, t.phone], q);
}

export default function DoorConsole({
  eventId,
  eventTitle,
  eventDate,
  parties,
  arrivals,
  notArrived,
  arrivedCount,
  expectedCount,
  outstandingCount,
  unaccountedCount,
}: Props) {
  const router = useRouter();

  const [tab, setTab] = useState<"registered" | "arrivals">("registered");
  // Which list the Arrivals tab is showing. "Who is still missing?" lives under the
  // same tab as "who is in", so a volunteer never has to look for it elsewhere.
  const [view, setView] = useState<"arrived" | "notarrived">("arrived");
  // One query behind both tabs, so a search carries across a tab switch.
  const [query, setQuery] = useState("");
  // Per-party resend status (keyed by registrationId): in-flight, success, or error.
  const [resend, setResend] = useState<
    Record<string, { sending?: boolean; ok?: boolean; error?: string }>
  >({});

  // Keep the roster + arrivals current during the event without a manual reload.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [router]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => parties.filter((p) => partyMatches(p, q)), [parties, q]);
  const visibleArrivals = useMemo(
    () => arrivals.filter((a) => ticketMatches(a, q)),
    [arrivals, q]
  );
  const visibleNotArrived = useMemo(
    () => notArrived.filter((a) => ticketMatches(a, q)),
    [notArrived, q]
  );
  // Both views draw the same row shape; only the arrived one carries a time.
  const rows: ListRow[] = view === "arrived" ? visibleArrivals : visibleNotArrived;
  // The same query against the other view — a guest searched for from the wrong side
  // gets a tappable jump instead of a dead end.
  const otherRows: ListRow[] = view === "arrived" ? visibleNotArrived : visibleArrivals;
  const otherLabel = view === "arrived" ? "Not arrived" : "Arrived";

  // Resend the booking email (lead QR + booking page) to a party's lead — for a guest
  // who arrives without their QR. The email goes to the registrant, not the operator.
  async function resendTickets(registrationId: string) {
    setResend((s) => ({ ...s, [registrationId]: { sending: true } }));
    try {
      const res = await fetch(`/api/public/door/${eventId}/resend-confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResend((s) => ({
          ...s,
          [registrationId]: { error: data.error || "Could not resend." },
        }));
        return;
      }
      setResend((s) => ({ ...s, [registrationId]: { ok: true } }));
    } catch (err) {
      console.error("[door/resend] request failed", err);
      setResend((s) => ({
        ...s,
        [registrationId]: {
          error:
            err instanceof DOMException && err.name === "TimeoutError"
              ? "Timed out — try again."
              : "Could not resend. Try again.",
        },
      }));
    }
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
          onClick={() => setTab("arrivals")}
          className={tabClass(tab === "arrivals")}
        >
          Arrivals{arrivedCount > 0 ? ` (${arrivedCount})` : ""}
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
                        {p.claimedCount} / {p.quantity} named
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
                        This party is full — everyone is named.
                      </p>
                    ) : p.isGuestList ? (
                      // A comp party's open seats belong to the sponsor — filling one gives
                      // away one of their seats, so route staff to the welcome desk first.
                      <p className="mt-4 font-body text-sm text-amber-700">
                        Comped seats — {p.remaining} {p.remaining === 1 ? "seat is" : "seats are"}{" "}
                        still unnamed. Check with the welcome desk before filling one.
                      </p>
                    ) : (
                      <p className="mt-4 font-body text-sm text-amber-700">
                        {p.remaining} {p.remaining === 1 ? "seat" : "seats"} still to name — fill the
                        details above or use the welcome desk.
                      </p>
                    )}

                    {/* Lost-QR helper: resend the booking email (QR + booking page) to
                        the lead's own address. */}
                    <div className="mt-3 border-t border-border pt-3">
                      {resend[p.registrationId]?.ok ? (
                        <p className="font-body text-sm text-emerald-700">
                          ✓ Ticket email resent to the lead’s address.
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => resendTickets(p.registrationId)}
                          disabled={resend[p.registrationId]?.sending}
                          className="w-full px-3 py-2.5 rounded-lg border border-marine/30 text-marine font-body font-semibold text-sm hover:bg-marine/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {resend[p.registrationId]?.sending
                            ? "Resending…"
                            : "Resend ticket email to lead"}
                        </button>
                      )}
                      {resend[p.registrationId]?.error && (
                        <p className="mt-2 font-body text-sm text-red-700">
                          {resend[p.registrationId]?.error}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {tab === "arrivals" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-white p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              {/* Counts reconcile exactly: outstanding === the not-arrived list's
                  length, because that list renders open slots too (KTD8). */}
              <p data-testid="arrival-counts" className="font-body text-sm text-marine/70">
                <span className="font-heading text-2xl font-bold text-marine">
                  {arrivedCount}
                </span>{" "}
                arrived · {expectedCount} expected · {outstandingCount} outstanding
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
          </div>

          {/* The seats sold and the ticket rows on this roster disagree, so some people
              with a valid ticket appear NOWHERE on this console — searching their name
              finds nothing. Say so, or the door quietly turns them away. */}
          {unaccountedCount !== 0 && (
            <p
              data-testid="unaccounted-warning"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-body text-sm font-semibold text-amber-900"
            >
              {unaccountedCount > 0
                ? `${unaccountedCount} expected ${unaccountedCount === 1 ? "guest has" : "guests have"} no row on this roster`
                : `${-unaccountedCount} more ${-unaccountedCount === 1 ? "ticket" : "tickets"} on this roster than seats sold`}{" "}
              — check with the welcome desk.
            </p>
          )}

          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setView("arrived")}
              className={tabClass(view === "arrived")}
            >
              Arrived ({arrivedCount})
            </button>
            <button
              type="button"
              onClick={() => setView("notarrived")}
              className={tabClass(view === "notarrived")}
            >
              Not arrived ({outstandingCount})
            </button>
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a guest or party"
            className={searchInputClass}
            autoComplete="off"
          />

          {rows.length === 0 ? (
            <div className="font-body text-base text-marine/70 bg-white border border-border rounded-xl px-4 py-4">
              {q && otherRows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setView(view === "arrived" ? "notarrived" : "arrived")}
                  className="w-full text-left cursor-pointer"
                >
                  <span className="text-marine">
                    {view === "arrived"
                      ? "Not in arrivals."
                      : "Not in the not-arrived list."}
                  </span>{" "}
                  <span className="font-semibold text-marine underline">
                    {otherRows.length} {otherRows.length === 1 ? "match" : "matches"} in{" "}
                    {otherLabel}
                  </span>
                </button>
              ) : q ? (
                "No match. Ask the guest which name the booking is under, or send them to the welcome desk."
              ) : view === "arrived" ? (
                "No arrivals yet."
              ) : (
                "Everyone expected is in."
              )}
            </div>
          ) : (
            <ul
              data-testid="arrivals-list"
              className="divide-y divide-border bg-white border border-border rounded-xl px-4"
            >
              {rows.map((row) => (
                <TicketRowItem key={row.id} row={row} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One arrivals-list row. Two lines, never more: the volunteer reads this on a phone in
 * the dark, and the shell caps at max-w-2xl. Line 1 is the guest name with the arrival
 * time right-aligned; line 2 is the party (truncated) plus the ticket-type and child
 * pills. An unnamed open slot still shows its party and type so the door knows what it
 * is holding.
 */
function TicketRowItem({ row }: { row: ListRow }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`min-w-0 truncate font-body text-lg ${
            row.name ? "text-marine" : "italic text-marine/50"
          }`}
        >
          {row.name || "Open slot"}
        </span>
        {row.arrivedAt && (
          <span className="shrink-0 font-body text-xs text-marine/50">
            {formatDateTime(row.arrivedAt)}
          </span>
        )}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-body text-sm text-marine/60">
          {row.partyName || "—"}
        </span>
        {row.ticketTypeTitle && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-body bg-marine/10 text-marine">
            {row.ticketTypeTitle}
          </span>
        )}
      </div>
    </li>
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
  const [needsWaiver, setNeedsWaiver] = useState(false);
  const [language, setLanguage] = useState<WaiverLanguage>("en");
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOpen = slot.attendeeId === null;
  // R13. A claimed guest holding neither email nor phone would otherwise be admitted
  // with no contact at all unless the volunteer thought to tap "Edit details" first.
  // Open its fields so contact is captured as part of the check-in, not behind an
  // extra tap.
  const needsContact = !isOpen && !slot.email && !slot.phone;
  // New open slots are editable immediately; claimed (live) rows start locked, unless
  // they are missing the contact we came here to capture.
  const [editing, setEditing] = useState(isOpen || needsContact);

  const locked = !editing;
  const dirty = isOpen
    ? name.trim() !== ""
    : name !== slot.name || email !== slot.email || (phone ?? "") !== slot.phone;

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (!email.trim() && !phone) {
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

  // Lost-QR check-in: a named ticket found in the roster is checked in by id.
  // If the waiver is unsigned the route returns needs_waiver — we surface a one-tap
  // accept, then re-submit. Idempotent on the server.
  async function checkInAdult(waiverAccepted: boolean) {
    setError(null);
    setCheckingIn(true);
    try {
      const res = await fetch(`/api/public/door/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: slot.attendeeId,
          waiverAccepted,
          language,
          marketingConsent,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not check in.");
        return;
      }
      if (data.status === "needs_waiver") {
        setNeedsWaiver(true);
        return;
      }
      setNeedsWaiver(false);
      onSaved();
    } catch (err) {
      console.error("[door/check-in] request failed", err);
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
          {/* "Arrived" (green) means this ticket has been scanned/checked in by the
              door clerk — never just pre-registered. A filled-but-not-scanned slot
              shows a muted "Not arrived" so pre-registration isn't mistaken for it. */}
          {slot.checkedIn ? (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-emerald-100 text-emerald-800">
              arrived{slot.arrivedAt ? ` · ${formatDateTime(slot.arrivedAt)}` : ""}
            </span>
          ) : (
            !isOpen && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-cream text-marine/50">
                not arrived
              </span>
            )
          )}
        </span>
        {!slot.checkedIn && !isOpen && (
          <button
            type="button"
            onClick={() => checkInAdult(false)}
            disabled={checkingIn}
            className="shrink-0 px-3 py-1 rounded-lg border border-marine text-marine text-xs font-body font-semibold hover:bg-marine hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          >
            {checkingIn ? "…" : "Check in"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className={fieldClass}
          autoComplete="off"
          disabled={locked}
        />
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
      </div>

      {needsContact && (
        <p className="mt-2 font-body text-sm text-amber-700">
          No contact on file — take an email or phone as you check them in.
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {needsWaiver && (
        <div className="mt-2 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-body text-base font-semibold text-amber-900">
              Read &amp; accept the waiver to check in.
            </p>
            <div className="flex gap-1 shrink-0">
              {(["en", "fr"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  className={`rounded-lg border-2 px-3 py-1 font-body text-sm font-semibold transition-colors ${
                    language === l
                      ? "border-marine bg-marine text-white"
                      : "border-marine/30 text-marine/60"
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <WaiverText lang={language} textSize="text-sm" maxHeightClass="max-h-56" />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-marine cursor-pointer"
            />
            <span className="font-body text-sm text-amber-900">
              They’d like to receive news and invitations from Geneva Polo Social Club.
            </span>
          </label>
          <button
            type="button"
            onClick={() => checkInAdult(true)}
            disabled={checkingIn}
            className="w-full px-3 py-3 rounded-lg bg-marine text-white font-body font-semibold text-base disabled:opacity-50 cursor-pointer"
          >
            {checkingIn ? "…" : "Accept & check in"}
          </button>
        </div>
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
          {/* No Cancel on a contactless claimed slot: re-locking it is exactly the
              state R13 exists to prevent. */}
          {!isOpen && !needsContact && (
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
