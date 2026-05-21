"use client";

import { useState } from "react";
import AttendeeList from "@/components/admin/AttendeeList";
import EventCheckInSettings from "@/components/admin/EventCheckInSettings";
import { formatDateTime } from "@/lib/format";

type Tab = "registrations" | "checkins" | "settings";

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
}: Props) {
  const [tab, setTab] = useState<Tab>("registrations");

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
        <button type="button" className={tabClass(tab === "settings")} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "registrations" && (
        <div className="space-y-10">
          <div>
            <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
              <p className={`text-sm font-body ${overbooked ? "text-red-700 font-semibold" : "text-muted-foreground"}`}>
                {attendees.length} registration{attendees.length === 1 ? "" : "s"} · {total} ticket
                {total === 1 ? "" : "s"}
                {" · "}
                {hasSeatCap
                  ? `${total} / ${seatCap} seats${overbooked ? " — overbooked" : ""}`
                  : "uncapped"}
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

          {hasSeatCap && (
            <div>
              <h2 className="font-heading text-xl font-bold text-marine mb-3">Waitlist</h2>
              {waitlist.length === 0 ? (
                <p className="font-body text-sm text-muted-foreground">No waitlist entries.</p>
              ) : (
                <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
                  <table className="min-w-full text-sm font-body">
                    <thead className="bg-cream/60 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Name</th>
                        <th className="px-4 py-2 text-left">Email</th>
                        <th className="px-4 py-2 text-left">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waitlist.map((entry) => (
                        <tr key={entry.id} className="border-t border-border/60">
                          <td className="px-4 py-2 text-marine">{entry.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{entry.email}</td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">{formatDateTime(entry.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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

      {tab === "settings" && (
        <EventCheckInSettings
          eventId={eventId}
          baseUrl={baseUrl}
          checkInPath={checkInPath}
          strictCheckin={strictCheckin}
        />
      )}
    </div>
  );
}
