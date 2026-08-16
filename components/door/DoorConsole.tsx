"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import PhoneInput from "@/components/common/PhoneInput";
import WaiverModal, {
  type WaiverAcceptance,
} from "@/components/events/WaiverModal";
// The shapes this console renders are the shapes buildDoorRoster produces — imported
// from the module that produces them rather than restated here, so the two cannot
// drift. Type-only, so lib/events/door-access's admin Supabase client is never pulled
// into the client bundle.
import type {
  DoorSlot,
  DoorParty,
  DoorArrival,
  DoorNotArrived,
  DoorGuestListGroup,
} from "@/lib/events/door-access";
import { bySurname, surnameKey } from "@/lib/events/roster-sort";

/**
 * What the arrivals list renders: a ticket row (contact fields ride along because the
 * arrivals search matches on them exactly as the Pre-registered tab's does (R15) — they
 * are never displayed), plus a time when it has arrived. DoorNotArrived is the nullable-
 * name variant: null is an unnamed open slot, rendered as "Open slot" (KTD8).
 */
type ListRow = DoorNotArrived & { arrivedAt?: string };

/**
 * What POST /api/public/door/[id]/check-in answers on the ticketId path.
 *
 * `status` is deliberately widened past the four the route sends today. The response is parsed
 * from JSON, so the compiler cannot promise it is one of them, and a union of exactly four
 * would let a caller narrow with `else` and treat a fifth as success. Callers must admit only
 * on an explicit `checked_in` / `already`.
 *
 * Note that a refusal arrives as HTTP 200 with a status, not as a non-2xx — `res.ok` alone
 * says nothing about whether the guest may come in.
 */
interface DoorCheckInResponse {
  status?: "checked_in" | "already" | "needs_waiver" | "not_recognised" | (string & {});
  error?: string;
}

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
  /**
   * Guest lists from the NEW list model (U5/U6/U9), as opposed to the OLD per-registration
   * `isGuestList` comp parties folded in above. Wired from
   * `lib/events/door-access.ts`'s `buildNewGuestListGroups`, via
   * `app/(checkin)/door/[id]/page.tsx` — a separate, independent read from
   * `buildDoorRoster`, since a guest-list ticket has no registration to attach a party to
   * (KD10) and is therefore invisible to that function by construction. Optional (defaults
   * to empty) so an event with no guest lists — old or new — renders exactly as it did
   * before this prop existed (regression guard). Renders in the SAME "Guest lists" tab as
   * the comp parties, reusing SlotRow so check-in, waiver and contact capture behave
   * identically for either model.
   */
  newGuestListGroups?: DoorGuestListGroup[];
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
  newGuestListGroups = [],
}: Props) {
  const router = useRouter();

  const [tab, setTab] = useState<"registered" | "arrivals" | "guestlists">("registered");
  // Which list the Arrivals tab is showing. "Who is still missing?" lives under the
  // same tab as "who is in", so a volunteer never has to look for it elsewhere.
  const [view, setView] = useState<"arrived" | "notarrived">("arrived");
  // One query behind both tabs, so a search carries across a tab switch.
  const [query, setQuery] = useState("");
  // Per-TICKET resend status (keyed by ticket id): in-flight, success, or error. Keyed per
  // ticket, not per party, because the resend now goes to the individual holder standing at
  // the desk rather than to whoever paid for the booking.
  const [resend, setResend] = useState<
    Record<string, { sending?: boolean; ok?: boolean; error?: string }>
  >({});

  // Keep the roster + arrivals current during the event without a manual reload.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [router]);

  const q = query.trim().toLowerCase();
  // The registered roster is a flat A–Z list of PEOPLE, ordered by the same comparator the
  // printed door sheet and the admin attendee list use. Grouping by party made staff know
  // whose booking a guest was on before they could find them — but the guest at the desk
  // gives their own name, not the buyer's. Each row still carries its booking as context.
  const registeredRows = useMemo(() => {
    const rows = parties.flatMap((party) =>
      party.slots.map((slot, i) => ({
        party,
        slot,
        key: slot.attendeeId ?? `${party.registrationId}-open-${i}`,
        sort: surnameKey(slot.name || null, party.referenceCode, Boolean(slot.attendeeId)),
      }))
    );
    rows.sort((a, b) => bySurname(a.sort, b.sort));
    return rows;
  }, [parties]);
  const visibleRegistered = useMemo(
    () =>
      registeredRows.filter(({ party, slot }) =>
        matchesQuery([slot.name, slot.email, slot.phone, party.leadName, party.referenceCode], q)
      ),
    [registeredRows, q]
  );
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

  // Resend ONE holder's QR to their own address — for the guest at the desk who can't find
  // their email. Goes to the ticket holder, never to the operator, and never to the lead:
  // the person asking is usually not the person who paid.
  async function resendTicket(ticketId: string) {
    setResend((s) => ({ ...s, [ticketId]: { sending: true } }));
    try {
      const res = await fetch(`/api/public/door/${eventId}/resend-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResend((s) => ({
          ...s,
          [ticketId]: { error: data.error || "Could not resend." },
        }));
        return;
      }
      setResend((s) => ({ ...s, [ticketId]: { ok: true } }));
    } catch (err) {
      console.error("[door/resend] request failed", err);
      setResend((s) => ({
        ...s,
        [ticketId]: {
          error:
            err instanceof DOMException && err.name === "TimeoutError"
              ? "Timed out — try again."
              : "Could not resend. Try again.",
        },
      }));
    }
  }

  const pct = expectedCount > 0 ? Math.round((arrivedCount / expectedCount) * 100) : 0;
  // Every seat this tab lists — named and still-open alike. It counted only NAMED seats
  // before, which was the retired "pre-registered" idea and made the door disagree with the
  // admin roster it is supposed to mirror.
  const attendeeCount = parties.reduce((s, p) => s + p.slots.length, 0);

  // Sponsor comp lists, e.g. a corporate partner who brought twelve guests. They are already in
  // Attendees, but scattered among every other party — this groups them so the door can work
  // one sponsor's list as a unit ("Cardis brought 12, here they are").
  //
  // Checking in happens here too. A comp list often has no emails — that is the nature of one —
  // so those guests never receive a ticket and arrive with no QR to scan. This list is how they
  // get admitted, not just a view of who was invited.
  //
  // It renders the SAME SlotRow the Attendees tab does rather than its own check-in: one
  // implementation reached from two places, so the waiver step, the contact capture and the
  // arrived state cannot diverge between the two tabs.
  const compGuestLists = useMemo(
    () =>
      parties
        .filter((p) => p.isGuestList)
        .map((p) => ({
          ...p,
          arrived: p.slots.filter((s) => s.checkedIn).length,
        }))
        // Biggest list first: that is the one the door spends its evening on.
        .sort((a, b) => b.slots.length - a.slots.length || a.leadName.localeCompare(b.leadName)),
    [parties],
  );

  /**
   * One unified "Guest lists" view over both models: the OLD per-registration comp party
   * (`isGuestList`) and the NEW `event_guest_lists` model (U5/U6, KD10). Staff should not
   * have to know or care which one produced a given sponsor's list — both are "a list of
   * names someone else vouched for", found and checked in the same way. `registrationId`
   * is `null` for a new-model group: it has no registration to save an edit against (see
   * the SlotRow usage below), which only matters if a name/contact edit is attempted —
   * check-in itself (checkInAdult) never reads it.
   */
  const guestListSections = useMemo(
    () => [
      ...compGuestLists.map((g) => ({
        key: g.registrationId,
        registrationId: g.registrationId as string | null,
        name: g.leadName || "Unnamed sponsor",
        referenceCode: g.referenceCode,
        contactName: null as string | null,
        arrived: g.arrived,
        slots: g.slots,
      })),
      ...newGuestListGroups.map((g) => ({
        key: g.id,
        registrationId: null as string | null,
        name: g.name || "Unnamed list",
        referenceCode: null as string | null,
        contactName: g.contactName || null,
        arrived: g.slots.filter((s) => s.checkedIn).length,
        slots: g.slots,
      })),
    ],
    [compGuestLists, newGuestListGroups],
  );

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
          Attendees{attendeeCount > 0 ? ` (${attendeeCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("arrivals")}
          className={tabClass(tab === "arrivals")}
        >
          Arrivals{arrivedCount > 0 ? ` (${arrivedCount})` : ""}
        </button>
        {/* Only worth a tab when the event actually has sponsor lists. Most don't. */}
        {guestListSections.length > 0 && (
          <button
            type="button"
            onClick={() => setTab("guestlists")}
            className={tabClass(tab === "guestlists")}
          >
            Guest lists ({guestListSections.length})
          </button>
        )}
      </div>

      {tab === "registered" && (
        <div className="space-y-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a guest, buyer or reference"
            className={searchInputClass}
            autoComplete="off"
          />

          <div className="space-y-3">
            {visibleRegistered.length === 0 ? (
              <p className="font-body text-base text-marine/70 bg-white border border-border rounded-xl px-4 py-4">
                {registeredRows.length === 0
                  ? "No tickets on the roster yet."
                  : "No match. Check the spelling, or send them to the welcome desk."}
              </p>
            ) : (
              visibleRegistered.map(({ party, slot, key }) => (
                <div
                  key={key}
                  data-testid="registered-row"
                  className="rounded-2xl border border-border bg-white p-4 shadow-sm"
                >
                  {/* The booking rides along as context, not as a container: staff need to
                      know which party a guest belongs to once they have found them, but they
                      find them by their own name. A comp list says so here, because its open
                      seats belong to the sponsor and must not be filled at the door. */}
                  {/* Labelled, because an unlabelled name at the top of a row full of names
                      reads as another guest. "Booked by" says what it is in two words, so the
                      heading below is unambiguously the person at the desk. Kept small and
                      grey: it is context for when it is needed (a guest who only knows whose
                      booking they are on), never something to scan. */}
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-body text-xs text-marine/50">
                      Booked by <span className="text-marine/70">{party.leadName || "—"}</span>
                      {party.referenceCode && (
                        <span className="font-mono"> · {party.referenceCode}</span>
                      )}
                    </p>
                    {party.isGuestList && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-body font-semibold text-amber-800">
                        Comp list
                      </span>
                    )}
                  </div>

                  {/* Open-seat guidance now sits ON the seat rather than as a party footnote:
                      it is a warning about the row the volunteer is looking at, and a comp
                      party's open seat belongs to the sponsor — filling it at the door gives
                      one of their seats away. */}
                  {!slot.attendeeId &&
                    (party.isGuestList ? (
                      <p className="mb-2 font-body text-sm text-amber-700">
                        Comped seats — this one belongs to the sponsor. Check with the welcome
                        desk before filling it.
                      </p>
                    ) : (
                      <p className="mb-2 font-body text-sm text-amber-700">
                        Open seat, still to name — fill the details below or use the welcome
                        desk.
                      </p>
                    ))}

                  <SlotRow
                    eventId={eventId}
                    registrationId={party.registrationId}
                    slot={slot}
                    onSaved={() => router.refresh()}
                    onResend={resendTicket}
                    resendState={slot.attendeeId ? resend[slot.attendeeId] : undefined}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "guestlists" && (
        <div className="space-y-4" data-testid="door-guest-lists">
          <p className="font-body text-sm text-marine/60">
            Who is on each sponsor&rsquo;s list, and where to check them in. Comp guests often
            have no email and so no QR to scan — tick them off here as they arrive.
          </p>

          {guestListSections.map((section) => (
            <section
              key={section.key}
              data-testid="door-guest-list"
              aria-label={section.name}
              className="rounded-xl border border-border bg-white overflow-hidden"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-cream/60 px-4 py-3">
                <div className="min-w-0">
                  <span className="font-body font-semibold text-marine">{section.name}</span>
                  {section.referenceCode && (
                    <span className="ml-2 font-mono text-xs text-marine/50">
                      {section.referenceCode}
                    </span>
                  )}
                  {/* A new-model list (U5/U6) names its own contact instead of carrying a
                      booking reference — the two models label themselves differently, but
                      both are "who to ask about this list". */}
                  {section.contactName && (
                    <span className="ml-2 font-body text-xs text-marine/50">
                      contact: {section.contactName}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-body text-sm text-marine/60 tabular-nums">
                  {section.arrived} of {section.slots.length} arrived
                </span>
              </header>

              <div className="space-y-2 p-3">
                {section.slots.map((slot, i) => (
                  <SlotRow
                    key={slot.attendeeId ?? `${section.key}-open-${i}`}
                    eventId={eventId}
                    // Empty for a new-model list (no registration behind it, KD10). Only
                    // matters if a name/contact edit is saved from this row — check-in
                    // itself (SlotRow's checkInAdult) never reads registrationId.
                    registrationId={section.registrationId ?? ""}
                    slot={slot}
                    onSaved={() => router.refresh()}
                    onResend={resendTicket}
                    resendState={slot.attendeeId ? resend[slot.attendeeId] : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
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
  onResend,
  resendState,
}: {
  eventId: string;
  registrationId: string;
  slot: DoorSlot;
  onSaved: () => void;
  /** Resend this holder's own QR to their own address. Omitted where there's nothing to
   *  resend to — an open (unclaimed) seat, or a claimed one with no email on file. */
  onResend?: (ticketId: string) => void;
  resendState?: { sending?: boolean; ok?: boolean; error?: string };
}) {
  const [name, setName] = useState(slot.name);
  const [email, setEmail] = useState(slot.email);
  const [phone, setPhone] = useState<string | null>(slot.phone || null);
  const [saving, setSaving] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [needsWaiver, setNeedsWaiver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = slot.attendeeId === null;
  // R7/U7. A claimed guest with no email would otherwise be admitted with nothing to
  // send a follow-up to, unless the volunteer thought to tap "Edit details" first.
  // Open its fields so an email can be captured as part of the check-in, not behind
  // an extra tap. Phone alone still satisfies *save* (below) — this only controls
  // whether the row starts open, since email is specifically what the follow-up needs.
  const needsContact = !isOpen && !slot.email;
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
  // If the waiver is unsigned the route returns needs_waiver — we raise the waiver modal and
  // re-submit with its acceptance. Idempotent on the server.
  //
  // `acceptance` is undefined on the first attempt (nothing signed yet) and carries the
  // guest's own language + consent choices on the second. Those choices live in the modal
  // rather than here, so the scan path and this one cannot answer them differently.
  async function checkInAdult(acceptance?: WaiverAcceptance) {
    setError(null);
    setCheckingIn(true);
    try {
      const res = await fetch(`/api/public/door/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: slot.attendeeId,
          waiverAccepted: acceptance !== undefined,
          language: acceptance?.language,
          marketingConsent: acceptance?.marketingConsent,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data: DoorCheckInResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not check in.");
        return;
      }
      if (data.status === "needs_waiver") {
        setNeedsWaiver(true);
        return;
      }
      // Only these two mean a person was admitted. Everything else — including a 200 the
      // server sends to say NO — has to stop here.
      //
      // This used to fall through to onSaved(): `not_recognised` is HTTP 200, and anything
      // that was not needs_waiver counted as success. So the modal closed cleanly, the row
      // refreshed, and the operator handed over a bracelet for a ticket the server had just
      // refused. Worse on the waiver path, where the guest had read and accepted first —
      // nothing was written, neither the check-in nor the acceptance.
      //
      // not_recognised is the server's answer for a ticket that is unknown to this event OR
      // cancelled (lib/events/checkin.ts maps both to not_found), so the wording cannot claim
      // it is merely unrecognised — a refunded seat is the likelier case at a real door.
      if (data.status !== "checked_in" && data.status !== "already") {
        setNeedsWaiver(false);
        setError(
          data.status === "not_recognised"
            ? "Not valid for this event — it may have been cancelled. Do not admit; check the roster."
            : "Could not check in. Try again, or find the guest by name in the roster."
        );
        if (data.status !== "not_recognised") {
          // An unknown status means the route grew an answer this screen does not know. It is
          // handled as a refusal above (never admit on a status we cannot read), and logged
          // because the only other symptom is a door that stops working for one guest.
          console.error("[door/check-in] unrecognised status from the route", {
            status: data.status,
          });
        }
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
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          {/* The two things door staff are chasing, in order: WHO is in front of them, and
              WHAT they are entitled to. The name leads at heading size; the type sits under it
              at a size meant to be read across a desk, not squinted at — it was xs, which on a
              long type ("Entrance + Traditional Asado Buffet") was unreadable at arm's length.
              No "lead" pill: that concept is retired, and at a door it never meant anything
              anyway — who paid is not who is standing there. */}
          <p className="font-heading text-xl font-bold leading-tight text-marine break-words">
            {slot.name || (
              <span className="font-body text-base font-normal text-marine/50">Open seat</span>
            )}
          </p>
          {slot.ticketTypeTitle && (
            <p className="mt-0.5 font-body text-sm font-semibold text-marine/75 break-words">
              {slot.ticketTypeTitle}
            </p>
          )}
        </div>

        {/* Arrival state and the action on it, stacked top-right: the status is the answer to
            "have I already done this one?", so it belongs beside the button that does it
            rather than trailing the type it has nothing to do with. */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {/* "Arrived" (green) means this ticket has been scanned/checked in by the
              door clerk — never just pre-registered. A filled-but-not-scanned slot
              shows a muted "Not arrived" so pre-registration isn't mistaken for it. */}
          {slot.checkedIn ? (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-emerald-100 text-emerald-800 whitespace-nowrap">
              arrived{slot.arrivedAt ? ` · ${formatDateTime(slot.arrivedAt)}` : ""}
            </span>
          ) : (
            !isOpen && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-body bg-cream text-marine/50 whitespace-nowrap">
                not arrived
              </span>
            )
          )}
          {!slot.checkedIn && !isOpen && (
            <button
              type="button"
              onClick={() => checkInAdult()}
              disabled={checkingIn}
              className="px-3 py-1 rounded-lg border border-marine text-marine text-xs font-body font-semibold hover:bg-marine hover:text-white transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {checkingIn ? "…" : "Check in"}
            </button>
          )}
        </div>
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
          No email on file — ask for one as you check them in. They can still be
          checked in without it.
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm font-body text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* The waiver takes the whole screen rather than a box inside this row — it is a legal
          document read on a phone, outdoors, with a queue waiting. Dismissing it leaves the
          guest un-checked-in, which is the honest outcome: nothing was signed. */}
      <WaiverModal
        open={needsWaiver}
        guestName={name || slot.name || ""}
        onAccept={(acceptance) => checkInAdult(acceptance)}
        onClose={() => setNeedsWaiver(false)}
        busy={checkingIn}
        error={error}
      />

      {/* Lost-QR helper, per holder: sends this person's own QR to their own address. Shown
          only where it can actually do something — a named seat with an email on file. The
          guest asking at the desk is usually not the one who paid, which is why this sits on
          the row rather than on the party. */}
      {onResend && slot.attendeeId && slot.email && (
        <div className="mt-2">
          {resendState?.ok ? (
            <p className="font-body text-sm text-emerald-700">
              ✓ QR code resent to {slot.email}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onResend(slot.attendeeId as string)}
              disabled={resendState?.sending}
              className="w-full px-3 py-2.5 rounded-lg border border-marine/30 text-marine font-body font-semibold text-sm hover:bg-marine/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {resendState?.sending ? "Sending…" : "Resend QR code"}
            </button>
          )}
          {resendState?.error && (
            <p className="mt-2 font-body text-sm text-red-700">{resendState.error}</p>
          )}
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
          {/* Cancel is offered even on a contactless claimed slot (R7/U7): a guest who
              declines to give an email must still be dismissible and checked in via the
              "Check in" button above, which never depends on this form. Withholding
              Cancel here would strand a declining guest in an open, unsavable row at
              the front of a queue. */}
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
