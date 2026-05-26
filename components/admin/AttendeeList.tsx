"use client";

import { useMemo, useState } from "react";
import { formatDateTime, formatCurrency } from "@/lib/format";

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
  // Arrival is derived from the presence of an event_checkins row.
  checkedIn: boolean;
  // Read-only per-type summary, e.g. "2× Standard, 2× Kids".
  breakdown: string;
}

interface Props {
  attendees: Attendee[];
}

type MemberFilter = "all" | "members" | "non_members";

function amountLabel(status: string, total: number) {
  if (status === "free" || total === 0) return "Free";
  return formatCurrency(total, { decimals: 2 });
}

export default function AttendeeList({ attendees }: Props) {
  const [query, setQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return attendees.filter((a) => {
      if (memberFilter === "members" && !a.is_member) return false;
      if (memberFilter === "non_members" && a.is_member) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
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
          placeholder="Search name or email"
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
          Showing {filtered.length} of {attendees.length} registration
          {attendees.length === 1 ? "" : "s"}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
          {attendees.length === 0
            ? "No registrations yet."
            : "No registrations match your search."}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead className="bg-cream/60 text-marine">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Name</th>
                  <th className="text-left px-4 py-3 font-semibold">Email</th>
                  <th className="text-left px-4 py-3 font-semibold">Member</th>
                  <th className="text-left px-4 py-3 font-semibold">Tickets</th>
                  <th className="text-left px-4 py-3 font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 font-semibold">Reference</th>
                  <th className="text-left px-4 py-3 font-semibold">Registered</th>
                  <th className="text-left px-4 py-3 font-semibold">Arrived</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-3 text-marine">{row.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.email}</td>
                    <td className="px-4 py-3">
                      {row.is_member ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">Yes</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-marine">{row.breakdown}</td>
                    <td className="px-4 py-3 text-marine">
                      {amountLabel(row.status, Number(row.total_amount_chf))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.reference_code}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatDateTime(row.created_at)}</td>
                    <td className="px-4 py-3">
                      {row.checkedIn ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">In</span>
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
