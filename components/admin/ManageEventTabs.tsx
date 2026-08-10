"use client";

import { useState } from "react";
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
}

interface Props {
  eventId: string;
  attendees: Attendee[];
  /** Stripe test mode → the roster's refund deep links target the test dashboard. */
  stripeTestMode: boolean;
  checkedInCount: number;
  /** Claimed attendees on the roster (for the "X of Y guests registered" summary). */
  guestsRegistered: number;
  /** Per-ticket-type breakdown shown at the top of the roster tab. */
  ticketTypeSummary: TicketTypeSummaryRow[];
  waitlist: Waitlist[];
  hasSeatCap: boolean;
  /**
   * Seats still standing (`seats_used`): sold minus cancelled. This is the figure the public
   * registration gate uses, so every seat decision in this component — the cap warning, the
   * convert-from-waitlist check, expected arrivals — is measured against the same number the
   * rest of the system is.
   */
  total: number;
  /** Seats bought, cancellations included. Display only. */
  sold: number;
  /** Seats given back, so sold and live visibly reconcile. */
  cancelledSeats: number;
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

export default function ManageEventTabs({
  eventId,
  attendees,
  stripeTestMode,
  checkedInCount,
  guestsRegistered,
  ticketTypeSummary,
  waitlist,
  hasSeatCap,
  total,
  sold,
  cancelledSeats,
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

  // Per-row convert state (quantity / in-flight / inline error) + a component-
  // level notice that survives the soft refresh after a successful conversion.
  const [rows, setRows] = useState<
    Record<string, { quantity: number; submitting: boolean; error: string | null }>
  >({});
  const [notice, setNotice] = useState<string | null>(null);

  function row(id: string) {
    return rows[id] ?? { quantity: 1, submitting: false, error: null };
  }
  function patchRow(id: string, patch: Partial<{ quantity: number; submitting: boolean; error: string | null }>) {
    setRows((s) => ({ ...s, [id]: { ...row(id), ...patch } }));
  }

  // Self-heal: hide waitlist entries whose email already has a registration
  // (e.g. an orphan left by a delete-after-insert failure).
  const registeredEmails = new Set(attendees.map((a) => a.email.toLowerCase()));
  const visibleWaitlist = waitlist.filter(
    (w) => !registeredEmails.has(w.email.toLowerCase())
  );

  async function convertEntry(entry: Waitlist) {
    const qty = row(entry.id).quantity;
    if (hasSeatCap && seatCap !== null && total + qty > seatCap) {
      if (
        !window.confirm(
          `This will put the event at ${total + qty} / ${seatCap} tickets — convert anyway?`
        )
      ) {
        return;
      }
    }
    patchRow(entry.id, { submitting: true, error: null });
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/waitlist/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waitlistId: entry.id, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) {
        patchRow(entry.id, { submitting: false, error: data.error || "Could not register." });
        return;
      }
      setNotice(
        data.email_sent === false
          ? `${entry.name} registered (ref ${data.reference_code}) — confirmation email failed, please notify them manually.`
          : `${entry.name} registered and emailed.`
      );
      router.refresh();
    } catch {
      patchRow(entry.id, { submitting: false, error: "Network error. Try again." });
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
                guestsRegistered={guestsRegistered}
                total={total}
                sold={sold}
                cancelledSeats={cancelledSeats}
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
                    <th className="px-4 py-2 text-left">Joined</th>
                    <th className="px-4 py-2 text-left">Register</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWaitlist.map((entry) => {
                    const r = row(entry.id);
                    return (
                      <tr key={entry.id} className="border-t border-border/60 align-top">
                        <td className="px-4 py-2 text-marine">{entry.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{entry.email}</td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">
                          {formatDateTime(entry.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={6}
                              value={r.quantity}
                              onChange={(e) =>
                                patchRow(entry.id, {
                                  quantity: Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                                })
                              }
                              className="w-14 px-2 py-1 rounded-md border border-border bg-white text-marine text-sm"
                              aria-label="Tickets"
                            />
                            <button
                              type="button"
                              onClick={() => convertEntry(entry)}
                              disabled={r.submitting}
                              className="px-3 py-1.5 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {r.submitting ? "Registering…" : "Register"}
                            </button>
                          </div>
                          {r.error && <p className="text-xs text-red-700 mt-1">{r.error}</p>}
                        </td>
                      </tr>
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
