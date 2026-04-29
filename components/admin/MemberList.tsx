"use client";

import { useState } from "react";
import Link from "next/link";
import { isAwaitingPayment } from "@/lib/members/status";

interface Member {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  member_number: string | null;
  tier_id: string;
  status: string;
  originator_id: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface MemberListProps {
  members: Member[];
  tierMap: Record<string, string>;
  originatorMap: Record<string, string>;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-sky/20 text-sky-dark",
  expired: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-800",
  declined: "bg-red-50 text-red-600",
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function MemberList({ members, tierMap, originatorMap }: MemberListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");

  const filtered = members.filter((m) => {
    const matchesSearch =
      search === "" ||
      `${m.first_name} ${m.last_name} ${m.email} ${m.member_number || ""}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    const matchesTier = tierFilter === "all" || m.tier_id === tierFilter;
    return matchesSearch && matchesStatus && matchesTier;
  });

  function exportCSV() {
    const headers = ["Name", "Email", "Member Number", "Tier", "Status", "Start Date", "End Date", "Originator", "Joined"];
    const rows = filtered.map((m) => [
      `${m.first_name} ${m.last_name}`,
      m.email,
      m.member_number || "",
      tierMap[m.tier_id] || "",
      m.status,
      m.start_date || "",
      m.end_date || "",
      m.originator_id ? originatorMap[m.originator_id] || "" : "",
      new Date(m.created_at).toLocaleDateString("en-GB"),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gpc-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const uniqueTiers = [...new Set(members.map((m) => m.tier_id))];

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or member number..."
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-lg border border-border bg-white text-sm font-body text-marine placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-body text-marine"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="expired">Expired</option>
          <option value="suspended">Suspended</option>
          <option value="declined">Declined</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-body text-marine"
        >
          <option value="all">All Tiers</option>
          {uniqueTiers.map((tid) => (
            <option key={tid} value={tid}>
              {tierMap[tid] || tid}
            </option>
          ))}
        </select>
        <button
          onClick={exportCSV}
          className="px-4 py-2.5 bg-white border border-border rounded-lg text-sm font-body text-marine hover:bg-cream transition-colors"
        >
          Export CSV
        </button>
      </div>

      <p className="text-sm text-muted-foreground font-body mb-4">
        {filtered.length} member{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream border-b border-border">
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Tier</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Membership Period</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Originator</th>
                <th className="text-left px-4 py-3 font-body font-medium text-muted-foreground">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/members/${m.id}`}
                      className="font-body font-medium text-marine hover:text-sky-dark"
                    >
                      {m.first_name} {m.last_name}
                    </Link>
                    {m.member_number && (
                      <span className="block text-xs text-muted-foreground font-body">
                        {m.member_number}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-body text-muted-foreground">{m.email}</td>
                  <td className="px-4 py-3 font-body text-marine">{tierMap[m.tier_id] || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-body font-medium ${statusColors[m.status] || "bg-gray-100 text-gray-600"}`}>
                        {m.status}
                      </span>
                      {isAwaitingPayment(m.status) && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                          Awaiting Payment
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-body text-muted-foreground">
                    {m.start_date || m.end_date ? (
                      <span className="text-xs">
                        {formatDate(m.start_date)} — {formatDate(m.end_date)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-body text-muted-foreground">
                    {m.originator_id ? originatorMap[m.originator_id] || "—" : "—"}
                  </td>
                  <td className="px-4 py-3 font-body text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
