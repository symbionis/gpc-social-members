"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AttendeeList from "@/components/admin/AttendeeList";
import RosterImport from "@/components/admin/RosterImport";
import EventCheckInPanel from "@/components/admin/EventCheckInPanel";
import EventCheckInSettings from "@/components/admin/EventCheckInSettings";
import EventInviteLink, { type InviteTicketType } from "@/components/admin/EventInviteLink";
import EventMessaging, {
  type ReminderSummaryRow,
  type SentMessageRow,
} from "@/components/admin/EventMessaging";
import { formatDateTime } from "@/lib/format";
import type { ReminderEntry } from "@/lib/events/reminder-schedule";
import type { TicketTypeLine } from "@/lib/events/tickets";

type Tab = "roster" | "checkin" | "import" | "messaging" | "waitlist" | "settings";

/** One person on the roster (event_attendees, claimed slots). */
interface Attendee {
  id: string;
  name: string;
  email: string;
  phone_e164: string;
  isMember: boolean;
  isLead: boolean;
  /** The lead's name for this party when the attendee is a guest, else "". */
  leadName: string;
  /** Tickets purchased for this party — present on the lead row only (null elsewhere). */
  ticketCount: number | null;
  /** Per-ticket-type breakdown for the lead's party; empty for guests / no party. */
  ticketBreakdown: TicketTypeLine[];
  waiverSigned: boolean;
  checkedIn: boolean;
  arrivedAt: string | null;
  createdAt: string;
}

interface Waitlist {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

interface Props {
  eventId: string;
  attendees: Attendee[];
  checkedInCount: number;
  waitlist: Waitlist[];
  hasSeatCap: boolean;
  total: number;
  seatCap: number | null;
  overbooked: boolean;
  csvHref: string;
  baseUrl: string;
  checkInPath: string;
  reminders: ReminderSummaryRow[];
  sentMessages: SentMessageRow[];
  reminderSchedule: ReminderEntry[];
  visibility: string;
  inviteCode: string | null;
  ticketTypes: InviteTicketType[];
  registrationEnabled: boolean;
}

export default function ManageEventTabs({
  eventId,
  attendees,
  checkedInCount,
  waitlist,
  hasSeatCap,
  total,
  seatCap,
  overbooked,
  csvHref,
  baseUrl,
  checkInPath,
  reminders,
  sentMessages,
  reminderSchedule,
  visibility,
  inviteCode,
  ticketTypes,
  registrationEnabled,
}: Props) {
  const [tab, setTab] = useState<Tab>("roster");
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
        <button type="button" className={tabClass(tab === "import")} onClick={() => setTab("import")}>
          Import
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
            <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
              <p className={`text-sm font-body ${overbooked ? "text-red-700 font-semibold" : "text-muted-foreground"}`}>
                {attendees.length} attendee{attendees.length === 1 ? "" : "s"}
                {" · "}
                {checkedInCount} arrived
                {" · "}
                {hasSeatCap
                  ? `${total} / ${seatCap} tickets${overbooked ? " — overbooked" : ""}`
                  : `${total} ticket${total === 1 ? "" : "s"} · uncapped`}
              </p>
              <a
                href={csvHref}
                className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
              >
                Export CSV
              </a>
            </div>
            <AttendeeList attendees={attendees} />
          </div>
        </div>
      )}

      {tab === "checkin" && (
        <EventCheckInPanel
          baseUrl={baseUrl}
          checkInPath={checkInPath}
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

      {tab === "import" && <RosterImport eventId={eventId} />}

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
