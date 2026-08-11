"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import AttendeeList, { type Attendee } from "@/components/admin/AttendeeList";
import GuestList, { type GuestListEntry } from "@/components/admin/GuestList";
import EventCheckInPanel from "@/components/admin/EventCheckInPanel";
import CancellationsPanel, { type CancellationRow } from "@/components/admin/CancellationsPanel";
import EventCheckInSettings from "@/components/admin/EventCheckInSettings";
import EventInviteLink, { type InviteTicketType } from "@/components/admin/EventInviteLink";
import EventRosterSummary, {
  type TicketTypeSummaryRow,
} from "@/components/admin/EventRosterSummary";
import EventMessaging, {
  type ReminderSummaryRow,
  type SentMessageRow,
} from "@/components/admin/EventMessaging";
import { formatDateTime } from "@/lib/format";
import type { ReminderEntry } from "@/lib/events/reminder-schedule";

type Tab = "roster" | "checkin" | "guestlist" | "refunds" | "messaging" | "waitlist" | "settings";

interface Waitlist {
  id: string;
  name: string;
  email: string;
  created_at: string;
  /** The ticket type the entry asked for at signup — may be null (legacy) or dangling. */
  ticket_type_id: string | null;
  /** The requested type's title, even when archived, so a flagged row still names what
   * was asked for (R14: no silent fallback). Null when ticket_type_id is null/dangling. */
  ticket_type_title: string | null;
  quantity: number | null;
  /** Whether an offer has ever been sent (offered_at !== null on the entry). */
  offered: boolean;
  offer_sent_count: number;
  /** R13/R14: false when the entry's type/quantity fail validation; Offer stays disabled
   * until an admin repairs it via the PATCH route. */
  offerable: boolean;
  /** Human-readable reason, present only when offerable is false. */
  offerable_reason: string | null;
  /** Whether editing the row can make it offerable. False for "already registered", where
   * no edit helps — the row must not offer a Fix that cannot fix it. */
  offerable_repairable: boolean;
  /** KTD3/R12: the entry's linked (or, for legacy rows, email-matched) registration has
   * reached paid/free. A redeemed entry is filtered out of the visible waitlist below. */
  redeemed: boolean;
}

interface Props {
  eventId: string;
  attendees: Attendee[];
  /** Stripe test mode → the roster's refund deep links target the test dashboard. */
  stripeTestMode: boolean;
  checkedInCount: number;
  /** Claimed attendees on the roster (for the "X of Y guests registered" summary). */
  /** Per-ticket-type breakdown shown at the top of the roster tab. */
  ticketTypeSummary: TicketTypeSummaryRow[];
  waitlist: Waitlist[];
  hasSeatCap: boolean;
  /**
   * Tickets still standing (`seats_used`): booked minus cancelled. This is the figure the public
   * registration gate uses, so every seat decision in this component — the cap warning, the
   * convert-from-waitlist check, expected arrivals — is measured against the same number the
   * rest of the system is.
   */
  total: number;
  /** Every ticket booked, cancellations included: paid + free + guest list. Display only. */
  booked: number;
  /** True when the authoritative active count could not be read, so booked/cancelled cannot
   * be reconciled and the breakdown must not be shown as fact. */
  figuresDegraded: boolean;
  /** Tickets paid for, cancellations included — the money figure. */
  paidTickets: number;
  /** Tickets on free bookings that are not a guest list. */
  freeTickets: number;
  /** Tickets given back, so booked and active visibly reconcile. */
  cancelledSeats: number;
  /** Comp tickets across every guest list, cancellations included — so it is on the same
   * basis as `booked`, not the (cancelled-excluding) attendee roster. */
  guestListSeats: number;
  /** How many sponsors hold a list. */
  guestListCount: number;
  seatCap: number | null;
  overbooked: boolean;
  baseUrl: string;
  reminders: ReminderSummaryRow[];
  sentMessages: SentMessageRow[];
  reminderSchedule: ReminderEntry[];
  visibility: string;
  inviteCode: string | null;
  ticketTypes: InviteTicketType[];
  registrationEnabled: boolean;
  /** The event's comp guest lists (is_guest_list registrations), for the Guest list tab. */
  guestLists: GuestListEntry[];
  /** Cancelled seats for the Refunds tab — kept off the roster, which is a door document. */
  cancellations: CancellationRow[];
}

type RowState = { submitting: boolean; error: string | null };

/** Per-entry submitting/error state for one action (Offer, Withdraw, or Repair) on the
 * waitlist table, keyed by entry id. Each action gets its own instance so submitting one
 * doesn't disable the others on the same row. */
function useRowState() {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  function get(id: string): RowState {
    return rows[id] ?? { submitting: false, error: null };
  }
  function patch(id: string, next: Partial<RowState>) {
    setRows((s) => ({ ...s, [id]: { ...get(id), ...next } }));
  }
  return [get, patch] as const;
}

export default function ManageEventTabs({
  eventId,
  attendees,
  stripeTestMode,
  checkedInCount,
  ticketTypeSummary,
  waitlist,
  hasSeatCap,
  total,
  booked,
  figuresDegraded,
  paidTickets,
  freeTickets,
  cancelledSeats,
  guestListSeats,
  guestListCount,
  seatCap,
  overbooked,
  baseUrl,
  reminders,
  sentMessages,
  reminderSchedule,
  visibility,
  inviteCode,
  ticketTypes,
  registrationEnabled,
  guestLists,
  cancellations,
}: Props) {
  const [tab, setTab] = useState<Tab>("roster");
  const pendingCancellations = cancellations.filter((c) => c.status === "requested").length;
  const router = useRouter();

  // Component-level notice banner that survives the soft refresh after a
  // successful Offer/Resend/Withdraw/repair action.
  const [notice, setNotice] = useState<string | null>(null);

  // Per-entry field overrides applied on top of the `waitlist` prop after a
  // successful Offer/Resend/Withdraw/repair — so the row re-renders immediately
  // (F4: "no full-page reload") rather than waiting on the next server fetch.
  // router.refresh() is still called for eventual consistency, but the visible
  // state change does not depend on it.
  const [overrides, setOverrides] = useState<Record<string, Partial<Waitlist>>>({});
  function applyOverride(id: string, patch: Partial<Waitlist>) {
    setOverrides((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }
  const effectiveWaitlist = waitlist.map((w) => ({ ...w, ...overrides[w.id] }));

  // Redeemed entries (KTD3/R12) are done — hide them from the working list rather
  // than showing an entry nobody can act on anymore.
  const visibleWaitlist = effectiveWaitlist.filter((w) => !w.redeemed);

  // Offer / Resend (R1, R3, R4): mints or resends a token by entry id. The route
  // rejects an unofferable, redeemed, or closed-registration entry — surfaced
  // inline rather than guessed at client-side.
  const [offerRow, patchOfferRow] = useRowState();

  async function sendOffer(entry: Waitlist) {
    if (!entry.offerable || offerRow(entry.id).submitting) return;
    patchOfferRow(entry.id, { submitting: true, error: null });
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/waitlist/${entry.id}/offer`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        patchOfferRow(entry.id, { submitting: false, error: data.error || "Could not send the offer." });
        return;
      }
      patchOfferRow(entry.id, { submitting: false, error: null });
      applyOverride(entry.id, { offered: true, offer_sent_count: data.offer_sent_count });
      setNotice(
        data.email_sent === false
          ? `Offer saved for ${entry.name} — the email failed to send, please notify them manually.`
          : `Offer sent to ${entry.name}.`
      );
      router.refresh();
    } catch {
      patchOfferRow(entry.id, { submitting: false, error: "Network error. Try again." });
    }
  }

  // Withdraw (R5a / AE10): clears the token; the entry returns to queued and its
  // old link stops resolving.
  const [withdrawRow, patchWithdrawRow] = useRowState();

  async function withdrawOffer(entry: Waitlist) {
    if (withdrawRow(entry.id).submitting) return;
    patchWithdrawRow(entry.id, { submitting: true, error: null });
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/waitlist/${entry.id}/offer`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        patchWithdrawRow(entry.id, { submitting: false, error: data.error || "Could not withdraw the offer." });
        return;
      }
      patchWithdrawRow(entry.id, { submitting: false, error: null });
      applyOverride(entry.id, { offered: false, offer_sent_count: 0 });
      setNotice(`Offer withdrawn for ${entry.name}.`);
      router.refresh();
    } catch {
      patchWithdrawRow(entry.id, { submitting: false, error: "Network error. Try again." });
    }
  }

  // Inline repair (F4/R14): a flagged row expands to a ticket-type + quantity
  // form. Only live, seat-counting types are offered — the same KTD6 constraint
  // the register route enforces — so a successful save is guaranteed offerable.
  const liveSeatTicketTypes = ticketTypes.filter((t) => t.counts_as_seat);
  const [repairOpen, setRepairOpen] = useState<Record<string, boolean>>({});
  const [repairDraft, setRepairDraft] = useState<
    Record<string, { ticketTypeId: string; quantity: number }>
  >({});
  const [repairRow, patchRepairRow] = useRowState();
  function draftFor(entry: Waitlist) {
    return (
      repairDraft[entry.id] ?? {
        ticketTypeId: entry.ticket_type_id ?? liveSeatTicketTypes[0]?.id ?? "",
        quantity: entry.quantity && entry.quantity >= 1 && entry.quantity <= 10 ? entry.quantity : 1,
      }
    );
  }
  function patchDraft(
    entry: Waitlist,
    patch: Partial<{ ticketTypeId: string; quantity: number }>
  ) {
    setRepairDraft((s) => ({ ...s, [entry.id]: { ...draftFor(entry), ...s[entry.id], ...patch } }));
  }
  function toggleRepair(id: string) {
    setRepairOpen((s) => ({ ...s, [id]: !s[id] }));
  }

  async function saveRepair(entry: Waitlist) {
    const draft = draftFor(entry);
    if (!draft.ticketTypeId) {
      patchRepairRow(entry.id, { error: "Choose a ticket type" });
      return;
    }
    patchRepairRow(entry.id, { submitting: true, error: null });
    try {
      const res = await fetch(`/api/admin/events/${eventId}/waitlist/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_type_id: draft.ticketTypeId, quantity: draft.quantity }),
      });
      const data = await res.json();
      if (!res.ok) {
        patchRepairRow(entry.id, { submitting: false, error: data.error || "Could not save." });
        return;
      }
      const title = liveSeatTicketTypes.find((t) => t.id === draft.ticketTypeId)?.title ?? null;
      applyOverride(entry.id, {
        ticket_type_id: draft.ticketTypeId,
        ticket_type_title: title,
        quantity: draft.quantity,
        offerable: true,
        offerable_reason: null,
        // Clear this too, or the optimistic row lands in offerable+repairable — a pair
        // deriveWaitlistOfferability never produces. Harmless while every consumer checks
        // `offerable` first; a trap for the one that eventually doesn't.
        offerable_repairable: false,
      });
      patchRepairRow(entry.id, { submitting: false, error: null });
      setRepairOpen((s) => ({ ...s, [entry.id]: false }));
      router.refresh();
    } catch {
      patchRepairRow(entry.id, { submitting: false, error: "Network error. Try again." });
    }
  }

  function tabClass(active: boolean) {
    return `px-5 py-3 text-sm font-body transition-colors cursor-pointer ${
      active
        ? "text-marine border-b-2 border-marine -mb-px"
        : "text-muted-foreground hover:text-marine"
    }`;
  }

  return (
    <div>
      <div className="flex border-b border-border mb-6">
        <button type="button" className={tabClass(tab === "roster")} onClick={() => setTab("roster")}>
          Attendees{attendees.length > 0 ? ` (${attendees.length})` : ""}
        </button>
        <button type="button" className={tabClass(tab === "checkin")} onClick={() => setTab("checkin")}>
          Check-in{checkedInCount > 0 ? ` (${checkedInCount})` : ""}
        </button>
        {(hasSeatCap || visibleWaitlist.length > 0) && (
          <button type="button" className={tabClass(tab === "waitlist")} onClick={() => setTab("waitlist")}>
            Waitlist{visibleWaitlist.length > 0 ? ` (${visibleWaitlist.length})` : ""}
          </button>
        )}
        <button
          type="button"
          className={tabClass(tab === "guestlist")}
          onClick={() => setTab("guestlist")}
        >
          Guest list
        </button>
        <button
          type="button"
          className={tabClass(tab === "refunds")}
          onClick={() => setTab("refunds")}
        >
          Refunds{cancellations.length > 0 ? ` (${cancellations.length})` : ""}
          {/* The tab carries its row count like Attendees and Waitlist do. The amber badge is a
              second, sharper signal: unsettled cancellations are money the club is holding that
              finance still counts as revenue, so they should not sit unnoticed. */}
          {pendingCancellations > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              {pendingCancellations} due
            </span>
          )}
        </button>
        <button type="button" className={tabClass(tab === "messaging")} onClick={() => setTab("messaging")}>
          Messaging
        </button>
        <button type="button" className={tabClass(tab === "settings")} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "roster" && (
        <div className="space-y-10">
          <div>
            <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
              <EventRosterSummary
                total={total}
                booked={booked}
                figuresDegraded={figuresDegraded}
                paidTickets={paidTickets}
                freeTickets={freeTickets}
                cancelledSeats={cancelledSeats}
                guestListSeats={guestListSeats}
                guestListCount={guestListCount}
                hasSeatCap={hasSeatCap}
                seatCap={seatCap}
                overbooked={overbooked}
                ticketTypeSummary={ticketTypeSummary}
              />
              <div className="shrink-0 flex gap-2">
                {/* The paper sheet staff tick off at the door: same rows as the CSV,
                    laid out to be scanned by surname rather than pivoted in Excel. */}
                <a
                  href={`/print/door-roster/${eventId}`}
                  target="_blank"
                  rel="noopener"
                  className="px-4 py-2 border border-marine text-marine rounded-lg text-sm font-body font-medium hover:bg-marine/5 transition-colors"
                >
                  Print door sheet
                </a>
              </div>
            </div>
            <AttendeeList
              attendees={attendees}
              baseUrl={baseUrl}
              eventId={eventId}
            />
          </div>
        </div>
      )}

      {tab === "checkin" && (
        <EventCheckInPanel
          baseUrl={baseUrl}
          eventId={eventId}
          arrivedCount={checkedInCount}
          // Arrivals are measured against total tickets sold (the true expected
          // headcount), not the roster row count — guests not yet self-registered
          // still count toward who's expected at the door.
          expectedCount={total}
          arrivals={attendees
            .filter((a) => a.checkedIn)
            .sort((a, b) => (b.arrivedAt ?? "").localeCompare(a.arrivedAt ?? ""))
            .map((a) => ({ id: a.id, name: a.name, arrivedAt: a.arrivedAt }))}
        />
      )}

      {tab === "waitlist" && (
        <div>
          <p className="text-sm font-body text-muted-foreground mb-3">
            {visibleWaitlist.length} on the waitlist
          </p>
          {notice && (
            <p className="font-body text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-3">
              {notice}
            </p>
          )}
          {visibleWaitlist.length === 0 ? (
            <p className="font-body text-sm text-muted-foreground">No waitlist entries.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
              <table className="min-w-full text-sm font-body">
                <thead className="bg-cream/60 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Requested</th>
                    <th className="px-4 py-2 text-left">Joined</th>
                    <th className="px-4 py-2 text-left">Offer</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWaitlist.map((entry) => {
                    const or = offerRow(entry.id);
                    const wr = withdrawRow(entry.id);
                    const rr = repairRow(entry.id);
                    const reasonId = `waitlist-reason-${entry.id}`;
                    const draft = draftFor(entry);
                    const isOpen = Boolean(repairOpen[entry.id]);
                    return (
                      <Fragment key={entry.id}>
                        <tr className="border-t border-border/60 align-top">
                          <td className="px-4 py-2 text-marine">{entry.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{entry.email}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {entry.ticket_type_title ?? "—"}
                            {entry.quantity ? ` × ${entry.quantity}` : ""}
                            {!entry.offerable && (
                              <>
                                {/* Repairable rows get one calm line and a Fix; the technical
                                    specifics wait in the panel, for whoever does the repair.
                                    An entry whose owner already holds a seat is NOT repairable
                                    — no edit makes it offerable — so it states the fact and
                                    offers no action, rather than sending an admin into a form
                                    that cannot help. */}
                                <p id={reasonId} className="text-xs text-amber-800 mt-0.5">
                                  {entry.offerable_repairable
                                    ? "Needs updating before it can be offered"
                                    : entry.offerable_reason}
                                </p>
                                {entry.offerable_repairable && (
                                  <button
                                    type="button"
                                    onClick={() => toggleRepair(entry.id)}
                                    className="text-xs text-marine underline mt-0.5 cursor-pointer"
                                  >
                                    {isOpen ? "Cancel" : "Fix"}
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {formatDateTime(entry.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => sendOffer(entry)}
                                aria-disabled={!entry.offerable || or.submitting}
                                aria-describedby={!entry.offerable ? reasonId : undefined}
                                className={`px-3 py-1.5 rounded-lg text-xs font-body font-medium transition-colors cursor-pointer ${
                                  !entry.offerable
                                    ? "bg-border/40 text-muted-foreground cursor-not-allowed"
                                    : "bg-marine text-white hover:bg-marine-light disabled:opacity-50"
                                }`}
                              >
                                {or.submitting
                                  ? entry.offered
                                    ? "Resending…"
                                    : "Offering…"
                                  : entry.offered
                                    ? "Resend"
                                    : "Offer"}
                              </button>
                              {entry.offered && (
                                <button
                                  type="button"
                                  onClick={() => withdrawOffer(entry)}
                                  disabled={wr.submitting}
                                  className="px-3 py-1.5 border border-border text-marine rounded-lg text-xs font-body font-medium hover:bg-marine/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {wr.submitting ? "Withdrawing…" : "Withdraw"}
                                </button>
                              )}
                            </div>
                            {entry.offered &&
                              (entry.offer_sent_count === 0 ? (
                                // The count only moves on a delivered send, so an offered
                                // entry still at 0 means the email never went out. The
                                // post-Offer notice is component state and does not
                                // survive a refresh — this does.
                                <p className="text-xs text-red-700 mt-1">
                                  Email not delivered — resend, or contact them directly
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Offered{entry.offer_sent_count > 1 ? ` ×${entry.offer_sent_count}` : ""}
                                </p>
                              ))}
                            {or.error && <p className="text-xs text-red-700 mt-1">{or.error}</p>}
                            {wr.error && <p className="text-xs text-red-700 mt-1">{wr.error}</p>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-border/60 bg-cream/30">
                            <td colSpan={5} className="px-4 py-3">
                              {entry.offerable_reason && (
                                <p className="text-xs text-amber-800 mb-2">
                                  {entry.offerable_reason}
                                </p>
                              )}
                              <div className="flex flex-wrap items-end gap-2">
                                <label className="text-xs text-muted-foreground">
                                  Ticket type
                                  <select
                                    value={draft.ticketTypeId}
                                    onChange={(e) => patchDraft(entry, { ticketTypeId: e.target.value })}
                                    className="block mt-1 px-2 py-1.5 rounded-md border border-border bg-white text-marine text-sm"
                                  >
                                    <option value="" disabled>
                                      Choose a type
                                    </option>
                                    {liveSeatTicketTypes.map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.title}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="text-xs text-muted-foreground">
                                  Quantity
                                  <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={draft.quantity}
                                    onChange={(e) =>
                                      patchDraft(entry, {
                                        quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                                      })
                                    }
                                    className="block mt-1 w-16 px-2 py-1.5 rounded-md border border-border bg-white text-marine text-sm"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => saveRepair(entry)}
                                  disabled={rr.submitting}
                                  className="px-3 py-1.5 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {rr.submitting ? "Saving…" : "Save"}
                                </button>
                                {rr.error && <p className="text-xs text-red-700">{rr.error}</p>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "guestlist" && (
        <GuestList
          eventId={eventId}
          ticketTypes={ticketTypes}
          guestLists={guestLists}
          hasSeatCap={hasSeatCap}
          seatCap={seatCap}
          total={total}
        />
      )}

      {tab === "refunds" && (
        <CancellationsPanel
          rows={cancellations}
          eventId={eventId}
          stripeTestMode={stripeTestMode}
        />
      )}

      {tab === "messaging" && (
        <EventMessaging
          eventId={eventId}
          reminders={reminders}
          sentMessages={sentMessages}
          reminderSchedule={reminderSchedule}
        />
      )}

      {tab === "settings" && (
        <div className="space-y-10">
          <EventCheckInSettings
            eventId={eventId}
            seatCap={seatCap}
            seatsUsed={total}
          />
          {visibility === "members_only" && (
            <EventInviteLink
              eventId={eventId}
              baseUrl={baseUrl}
              inviteCode={inviteCode}
              ticketTypes={ticketTypes}
              registrationEnabled={registrationEnabled}
            />
          )}
        </div>
      )}
    </div>
  );
}
