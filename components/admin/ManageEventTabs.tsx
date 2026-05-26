"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AttendeeList from "@/components/admin/AttendeeList";
import EventCheckInSettings from "@/components/admin/EventCheckInSettings";
import EventInviteLink, { type InviteTicketType } from "@/components/admin/EventInviteLink";
import EventMessaging, {
  type ReminderSummaryRow,
  type SentMessageRow,
} from "@/components/admin/EventMessaging";
import { formatDateTime } from "@/lib/format";
import type { ReminderEntry } from "@/lib/events/reminder-schedule";

type Tab = "registrations" | "checkins" | "messaging" | "waitlist" | "settings";

interface Attendee {
  id: string;
  name: string;
  email: string;
  is_member: boolean;
  quantity: number;
  total_amount_chf: number;
  status: string;
  reference_code: string;
  created_at: string;
  checkedIn: boolean;
}

interface Checkin {
  id: string;
  name: string;
  email: string;
  kind: string;
  inviter_name: string | null;
  registration_id: string | null;
  member_id: string | null;
  invited_by_registration_id: string | null;
  created_at: string;
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
  checkins: Checkin[];
  waitlist: Waitlist[];
  hasSeatCap: boolean;
  total: number;
  seatCap: number | null;
  overbooked: boolean;
  csvHref: string;
  baseUrl: string;
  checkInPath: string;
  strictCheckin: boolean;
  reminders: ReminderSummaryRow[];
  sentMessages: SentMessageRow[];
  reminderSchedule: ReminderEntry[];
  visibility: string;
  inviteCode: string | null;
  ticketTypes: InviteTicketType[];
  registrationEnabled: boolean;
}

const KIND_LABEL: Record<string, string> = {
  member: "Member",
  guest: "Guest",
  registered: "Registered",
};

const KIND_BADGE: Record<string, string> = {
  member: "bg-sky/10 text-sky-dark",
  registered: "bg-emerald-100 text-emerald-800",
  guest: "bg-amber-100 text-amber-800",
};

type HostGroup = {
  key: string;
  label: string;
  kind: "registered" | "member" | "pending";
  arrivedAt: string | null;
  guests: Checkin[];
};

// Group door arrivals: registrant/member check-ins are "hosts"; invited guests
// nest under the registrant they picked. Guests whose host hasn't checked in yet
// still group under that host (labelled from the inviter name); guests with no
// link fall into a flat "Other guests" list.
function buildGroups(checkins: Checkin[]): {
  groups: HostGroup[];
  unlinked: Checkin[];
} {
  const principals = checkins.filter(
    (c) => c.kind === "registered" || c.kind === "member"
  );
  const guests = checkins.filter((c) => c.kind === "guest");

  const guestsByHostReg = new Map<string, Checkin[]>();
  const unlinked: Checkin[] = [];
  for (const g of guests) {
    if (g.invited_by_registration_id) {
      const arr = guestsByHostReg.get(g.invited_by_registration_id) ?? [];
      arr.push(g);
      guestsByHostReg.set(g.invited_by_registration_id, arr);
    } else {
      unlinked.push(g);
    }
  }

  const groups: HostGroup[] = [];
  const renderedRegIds = new Set<string>();
  for (const p of principals) {
    const guestsForP = p.registration_id
      ? guestsByHostReg.get(p.registration_id) ?? []
      : [];
    if (p.registration_id) renderedRegIds.add(p.registration_id);
    groups.push({
      key: p.id,
      label: p.name,
      kind: p.kind === "member" ? "member" : "registered",
      arrivedAt: p.created_at,
      guests: guestsForP,
    });
  }
  // Hosts referenced by guests but who have not checked in themselves.
  for (const [regId, gs] of guestsByHostReg) {
    if (renderedRegIds.has(regId)) continue;
    groups.push({
      key: regId,
      label: gs[0].inviter_name ?? "Invited guest's host",
      kind: "pending",
      arrivedAt: null,
      guests: gs,
    });
  }

  return { groups, unlinked };
}

export default function ManageEventTabs({
  eventId,
  attendees,
  checkins,
  waitlist,
  hasSeatCap,
  total,
  seatCap,
  overbooked,
  csvHref,
  baseUrl,
  checkInPath,
  strictCheckin,
  reminders,
  sentMessages,
  reminderSchedule,
  visibility,
  inviteCode,
  ticketTypes,
  registrationEnabled,
}: Props) {
  const [tab, setTab] = useState<Tab>("registrations");
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

  const { groups, unlinked } = buildGroups(checkins);

  return (
    <div>
      <div className="flex border-b border-border mb-6">
        <button type="button" className={tabClass(tab === "registrations")} onClick={() => setTab("registrations")}>
          Registrations
        </button>
        <button type="button" className={tabClass(tab === "checkins")} onClick={() => setTab("checkins")}>
          Check-ins{checkins.length > 0 ? ` (${checkins.length})` : ""}
        </button>
        {(hasSeatCap || visibleWaitlist.length > 0) && (
          <button type="button" className={tabClass(tab === "waitlist")} onClick={() => setTab("waitlist")}>
            Waitlist{visibleWaitlist.length > 0 ? ` (${visibleWaitlist.length})` : ""}
          </button>
        )}
        <button type="button" className={tabClass(tab === "messaging")} onClick={() => setTab("messaging")}>
          Messaging
        </button>
        <button type="button" className={tabClass(tab === "settings")} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "registrations" && (
        <div className="space-y-10">
          <div>
            <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
              <p className={`text-sm font-body ${overbooked ? "text-red-700 font-semibold" : "text-muted-foreground"}`}>
                {attendees.length} registration{attendees.length === 1 ? "" : "s"}
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
            <AttendeeList attendees={attendees} eventId={eventId} seatCap={seatCap} />
          </div>
        </div>
      )}

      {tab === "checkins" && (
        <div className="space-y-6">
          <p className="text-sm font-body text-muted-foreground">
            {checkins.length} checked in
          </p>

          {checkins.length === 0 ? (
            <p className="font-body text-sm text-muted-foreground">
              No one has checked in yet. Arrivals appear here as guests scan the QR.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.key} className="rounded-sm border border-border/60 bg-white overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 bg-cream/40">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-body font-semibold text-marine">{group.label}</span>
                      {group.kind === "pending" ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                          host not checked in
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${KIND_BADGE[group.kind]}`}>
                          {KIND_LABEL[group.kind]}
                        </span>
                      )}
                    </div>
                    {group.arrivedAt && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDateTime(group.arrivedAt)}
                      </span>
                    )}
                  </div>
                  {group.guests.length > 0 && (
                    <ul className="divide-y divide-border/60">
                      {group.guests.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2 pl-8">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-body text-marine">{g.name}</span>
                            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">
                              Guest
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatDateTime(g.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {unlinked.length > 0 && (
                <div className="rounded-sm border border-border/60 bg-white overflow-hidden">
                  <div className="px-4 py-3 bg-cream/40 font-body font-semibold text-marine">
                    Other guests
                  </div>
                  <ul className="divide-y divide-border/60">
                    {unlinked.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-body text-marine">{g.name}</span>
                          {g.inviter_name && (
                            <span className="text-xs text-muted-foreground">invited by {g.inviter_name}</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatDateTime(g.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
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
            baseUrl={baseUrl}
            checkInPath={checkInPath}
            strictCheckin={strictCheckin}
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
