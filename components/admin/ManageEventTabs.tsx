"use client";

import { useState } from "react";
import AttendeeList from "@/components/admin/AttendeeList";
import EventCheckInSettings from "@/components/admin/EventCheckInSettings";
import { formatDateTime } from "@/lib/format";

type Tab = "registrations" | "settings";

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

interface WalkIn {
  id: string;
  name: string;
  email: string;
  kind: string;
  inviter_name: string | null;
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
  walkIns: WalkIn[];
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

export default function ManageEventTabs({
  eventId,
  attendees,
  walkIns,
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

  return (
    <div>
      <div className="flex border-b border-border mb-6">
        <button
          type="button"
          className={tabClass(tab === "registrations")}
          onClick={() => setTab("registrations")}
        >
          Registrations
        </button>
        <button
          type="button"
          className={tabClass(tab === "settings")}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {tab === "registrations" ? (
        <div className="space-y-10">
          <div>
            <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
              <p
                className={`text-sm font-body ${
                  overbooked ? "text-red-700 font-semibold" : "text-muted-foreground"
                }`}
              >
                {attendees.length} registration{attendees.length === 1 ? "" : "s"} ·{" "}
                {total} ticket{total === 1 ? "" : "s"}
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

          <div>
            <h2 className="font-heading text-xl font-bold text-marine mb-3">
              Walk-in arrivals
            </h2>
            {walkIns.length === 0 ? (
              <p className="font-body text-sm text-muted-foreground">
                No walk-in members or invited guests have checked in yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
                <table className="min-w-full text-sm font-body">
                  <thead className="bg-cream/60 text-marine">
                    <tr>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Email</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-left">Invited by</th>
                      <th className="px-4 py-2 text-left">Arrived</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walkIns.map((w) => (
                      <tr key={w.id} className="border-t border-border/60">
                        <td className="px-4 py-2 text-marine">{w.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{w.email}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-sky/10 text-sky-dark">
                            {KIND_LABEL[w.kind] ?? w.kind}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {w.inviter_name ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">
                          {formatDateTime(w.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {hasSeatCap && (
            <div>
              <h2 className="font-heading text-xl font-bold text-marine mb-3">
                Waitlist
              </h2>
              {waitlist.length === 0 ? (
                <p className="font-body text-sm text-muted-foreground">
                  No waitlist entries.
                </p>
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
                          <td className="px-4 py-2 text-muted-foreground">
                            {entry.email}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {formatDateTime(entry.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
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
