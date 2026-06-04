"use client";

import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { formatTicketBreakdown, type TicketTypeLine } from "@/lib/events/tickets";

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

interface Props {
  attendees: Attendee[];
}

type MemberFilter = "all" | "members" | "non_members";

export default function AttendeeList({ attendees }: Props) {
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (memberFilter === "members" && !a.isMember) return false;
      if (memberFilter === "non_members" && a.isMember) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone_e164.toLowerCase().includes(q)
      );
    });
  }, [attendees, query, memberFilter]);

  const isFiltering = query.trim() !== "" || memberFilter !== "all";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or phone"
          className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-body text-muted-foreground">Member</label>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value as MemberFilter)}
            className="px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm cursor-pointer"
          >
            <option value="all">All</option>
            <option value="members">Members</option>
            <option value="non_members">Non-members</option>
          </select>
        </div>
      </div>

      {isFiltering && (
        <p className="text-xs font-body text-muted-foreground">
          Showing {filtered.length} of {attendees.length} attendee
          {attendees.length === 1 ? "" : "s"}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
          {attendees.length === 0
            ? "No attendees yet."
            : "No attendees match your search."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead className="bg-cream/60 text-marine">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Name</th>
                  <th className="text-left px-4 py-3 font-semibold">Contact</th>
                  <th className="text-left px-4 py-3 font-semibold">Member</th>
                  <th className="text-left px-4 py-3 font-semibold">Party / Lead</th>
                  <th className="text-left px-4 py-3 font-semibold">Tickets</th>
                  <th className="text-left px-4 py-3 font-semibold">Waiver</th>
                  <th className="text-left px-4 py-3 font-semibold">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 text-marine">{row.name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex flex-col gap-0.5">
                        {row.email && <span>{row.email}</span>}
                        {row.phone_e164 && (
                          <span className="font-mono text-xs">{row.phone_e164}</span>
                        )}
                        {!row.email && !row.phone_e164 && <span>—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.isMember ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Yes</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-marine">
                      {row.isLead ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-sky/10 text-sky-dark">Lead</span>
                      ) : row.leadName ? (
                        <span className="text-xs text-muted-foreground">
                          Guest of {row.leadName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.ticketCount != null ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-marine font-semibold">
                            {row.ticketCount}
                          </span>
                          {row.ticketBreakdown.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {formatTicketBreakdown(row.ticketBreakdown)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.waiverSigned ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Signed</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Unsigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.checkedIn ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 w-fit">In</span>
                          {row.arrivedAt && (
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(row.arrivedAt)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
