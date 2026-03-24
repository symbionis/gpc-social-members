"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  tier_id: string;
  status: string;
  connection_note: string | null;
  originator_id: string | null;
  created_at: string;
}

interface ApplicationQueueProps {
  applications: Application[];
  tierMap: Record<string, { name: string; price_cents: number }>;
  originatorMap: Record<string, string>;
}

export default function ApplicationQueue({
  applications,
  tierMap,
  originatorMap,
}: ApplicationQueueProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("pending");
  const [processing, setProcessing] = useState<string | null>(null);
  const [declineNotes, setDeclineNotes] = useState("");
  const [showDeclineModal, setShowDeclineModal] = useState<string | null>(null);

  const filtered =
    filter === "all"
      ? applications
      : applications.filter((a) => a.status === filter);

  async function handleApprove(memberId: string) {
    setProcessing(memberId);
    const res = await fetch("/api/admin/applications/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId }),
    });

    if (res.ok) {
      router.refresh();
    }
    setProcessing(null);
  }

  async function handleDecline(memberId: string) {
    setProcessing(memberId);
    const res = await fetch("/api/admin/applications/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, notes: declineNotes }),
    });

    if (res.ok) {
      setShowDeclineModal(null);
      setDeclineNotes("");
      router.refresh();
    }
    setProcessing(null);
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {["pending", "approved", "declined", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-body capitalize transition-colors ${
              filter === f
                ? "bg-marine text-white"
                : "bg-white text-marine border border-border hover:bg-cream"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Applications list */}
      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-border p-8 text-center">
            <p className="text-muted-foreground font-body">
              No {filter === "all" ? "" : filter} applications.
            </p>
          </div>
        )}

        {filtered.map((app) => (
          <div
            key={app.id}
            className="bg-white rounded-xl border border-border p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-body font-semibold text-marine text-lg">
                  {app.first_name} {app.last_name}
                </h3>
                <p className="text-sm text-muted-foreground font-body">
                  {app.email}
                  {app.phone && ` · ${app.phone}`}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-body font-medium ${
                  app.status === "pending"
                    ? "bg-amber-100 text-amber-800"
                    : app.status === "approved"
                      ? "bg-sky/20 text-sky-dark"
                      : "bg-red-100 text-red-800"
                }`}
              >
                {app.status}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm mb-4">
              <div>
                <p className="text-muted-foreground font-body">Tier</p>
                <p className="font-body font-medium text-marine">
                  {tierMap[app.tier_id]?.name || "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground font-body">Originator</p>
                <p className="font-body font-medium text-marine">
                  {app.originator_id
                    ? originatorMap[app.originator_id] || "Unknown"
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground font-body">Applied</p>
                <p className="font-body font-medium text-marine">
                  {new Date(app.created_at).toLocaleDateString("en-GB")}
                </p>
              </div>
            </div>

            {app.connection_note && (
              <div className="bg-cream rounded-lg p-3 mb-4">
                <p className="text-xs text-muted-foreground font-body mb-1">
                  Connection note
                </p>
                <p className="text-sm font-body text-marine">
                  {app.connection_note}
                </p>
              </div>
            )}

            {app.status === "pending" && (
              <div className="flex gap-3">
                <button
                  onClick={() => handleApprove(app.id)}
                  disabled={processing === app.id}
                  className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
                >
                  {processing === app.id ? "Processing..." : "Approve"}
                </button>
                <button
                  onClick={() => setShowDeclineModal(app.id)}
                  disabled={processing === app.id}
                  className="px-4 py-2 bg-white text-destructive border border-destructive/30 rounded-lg text-sm font-body font-medium hover:bg-destructive/5 transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            )}

            {/* Decline modal */}
            {showDeclineModal === app.id && (
              <div className="mt-4 p-4 bg-cream rounded-lg border border-border">
                <p className="text-sm font-body font-medium text-marine mb-2">
                  Decline reason (optional)
                </p>
                <textarea
                  value={declineNotes}
                  onChange={(e) => setDeclineNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm font-body text-marine resize-none focus:outline-none focus:ring-2 focus:ring-sky/50 mb-3"
                  placeholder="Reason for declining..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecline(app.id)}
                    disabled={processing === app.id}
                    className="px-4 py-2 bg-destructive text-white rounded-lg text-sm font-body font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  >
                    Confirm Decline
                  </button>
                  <button
                    onClick={() => {
                      setShowDeclineModal(null);
                      setDeclineNotes("");
                    }}
                    className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
