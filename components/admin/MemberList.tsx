"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAwaitingPayment } from "@/lib/members/status";
import { formatDate, formatMonth } from "@/lib/format";
import {
  availablePaymentMonths,
  matchesPaidFilter,
  matchesMonthFilter,
  type PaidFilter,
  type PaidMonthsByMember,
} from "@/lib/members/payments";
import { paginate } from "@/lib/pagination";

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
  paidMonthsByMember: PaidMonthsByMember;
  // false when the payments fetch errored mid-read, so the paid/month data is
  // partial and the Paid/Month filters can't be trusted.
  paymentsComplete: boolean;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-sky/20 text-sky-dark",
  expired: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-800",
  declined: "bg-red-50 text-red-600",
};

const PAGE_SIZE = 25;

export default function MemberList({ members, tierMap, originatorMap, paidMonthsByMember, paymentsComplete }: MemberListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Reset to the first page whenever the active filter set changes, so you're
  // never stranded on a page index the narrowed result no longer has.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, tierFilter, paidFilter, monthFilter]);

  const monthOptions = availablePaymentMonths(paidMonthsByMember);
  const expiredCount = members.filter((m) => m.status === "expired").length;

  async function handleBulkReactivation() {
    if (
      !window.confirm(
        `Send a reactivation email to all ${expiredCount} expired members? Members emailed in the last 14 days will be skipped.`
      )
    ) {
      return;
    }
    setBulkSending(true);
    setBulkResult(null);
    const res = await fetch("/api/admin/members/bulk-reactivation-expired", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBulkSending(false);
    const data = await res.json();
    if (!res.ok) {
      setBulkResult(`Error: ${data.error || "Failed to send"}`);
      return;
    }
    const errSuffix = data.errors?.length ? `, ${data.errors.length} failed` : "";
    setBulkResult(`Sent ${data.sent}, skipped ${data.skipped}${errSuffix}.`);
    router.refresh();
  }

  const filtered = members.filter((m) => {
    const matchesSearch =
      search === "" ||
      `${m.first_name} ${m.last_name} ${m.email} ${m.member_number || ""}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "awaiting_payment"
        ? isAwaitingPayment(m.status)
        : m.status === statusFilter);
    const matchesTier = tierFilter === "all" || m.tier_id === tierFilter;
    const matchesPaid = matchesPaidFilter(paidMonthsByMember[m.id], paidFilter);
    const matchesMonth = matchesMonthFilter(paidMonthsByMember[m.id], monthFilter);
    return matchesSearch && matchesStatus && matchesTier && matchesPaid && matchesMonth;
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
      formatDate(m.created_at),
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

  // Paginate the filtered rows for display. Count and CSV still use the full
  // `filtered` set, so they reflect every match, not just the current page.
  const { pageRows, totalPages, currentPage, from, to, total } = paginate(
    filtered,
    page,
    PAGE_SIZE,
  );

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
          <option value="awaiting_payment">Awaiting Payment</option>
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
        <select
          value={paidFilter}
          onChange={(e) => setPaidFilter(e.target.value as PaidFilter)}
          className="px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-body text-marine"
        >
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Not paid</option>
        </select>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-border bg-white text-sm font-body text-marine"
        >
          <option value="all">All months</option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
        <button
          onClick={exportCSV}
          className="px-4 py-2.5 bg-white border border-border rounded-lg text-sm font-body text-marine hover:bg-cream transition-colors"
        >
          Export CSV
        </button>
        {statusFilter === "expired" && expiredCount > 0 && (
          <button
            onClick={handleBulkReactivation}
            disabled={bulkSending}
            className="px-4 py-2.5 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
          >
            {bulkSending ? "Sending..." : `Send Reactivation to ${expiredCount} Expired`}
          </button>
        )}
      </div>

      {bulkResult && (
        <p className="text-sm font-body text-marine mb-4">{bulkResult}</p>
      )}

      {!paymentsComplete && (
        <p className="text-sm font-body text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4">
          Payment data couldn&apos;t be fully loaded, so the Paid and month
          filters may be incomplete.
        </p>
      )}

      <p className="text-sm text-muted-foreground font-body mb-4">
        {total === 0
          ? "0 members"
          : `Showing ${from}–${to} of ${total} member${total !== 1 ? "s" : ""}`}
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
              {pageRows.map((m) => (
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
                    {formatDate(m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-4 py-2 bg-white border border-border rounded-lg text-sm font-body text-marine hover:bg-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground font-body">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 bg-white border border-border rounded-lg text-sm font-body text-marine hover:bg-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
