"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemberStatus, PaymentCaptureStatus } from "@/types/database";

interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  tier_id: string;
  status: MemberStatus;
  originator_note: string | null;
  originator_id: string | null;
  created_at: string;
}

interface PaymentInfo {
  payment_capture_status: PaymentCaptureStatus;
  capture_before: string | null;
  authorized_at: string | null;
}

interface ApplicationQueueProps {
  applications: Application[];
  tierMap: Record<string, { name: string; price_eur: number }>;
  originatorMap: Record<string, string>;
  paymentMap: Record<string, PaymentInfo>;
}

function PaymentStatusBadge({ status }: { status: PaymentCaptureStatus }) {
  const styles: Record<PaymentCaptureStatus, string> = {
    authorized: "bg-green-100 text-green-800",
    hold_expired: "bg-orange-100 text-orange-800",
    succeeded: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    requires_action: "bg-purple-100 text-purple-800",
    charging_offsession: "bg-blue-100 text-blue-800",
    pending: "bg-gray-100 text-gray-800",
    cancelled: "bg-gray-100 text-gray-500",
  };

  const labels: Record<PaymentCaptureStatus, string> = {
    authorized: "Card Authorized",
    hold_expired: "Hold Expired",
    succeeded: "Paid",
    failed: "Payment Failed",
    requires_action: "Needs Auth",
    charging_offsession: "Charging...",
    pending: "Awaiting Card",
    cancelled: "Cancelled",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-body font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

export default function ApplicationQueue({
  applications,
  tierMap,
  originatorMap,
  paymentMap,
}: ApplicationQueueProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("pending");
  const [processing, setProcessing] = useState<string | null>(null);
  const [declineNotes, setDeclineNotes] = useState("");
  const [showDeclineModal, setShowDeclineModal] = useState<string | null>(null);
  const [showHoldExpiredConfirm, setShowHoldExpiredConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const filtered =
    filter === "all"
      ? applications
      : applications.filter((a) => a.status === filter);

  async function handleApprove(memberId: string) {
    setProcessing(memberId);
    setActionError(null);
    setActionMessage(null);

    const res = await fetch("/api/admin/applications/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.payment_status === "failed") {
        setActionMessage(data.message);
      } else if (data.payment_status === "requires_action") {
        setActionMessage(data.message);
      }
      router.refresh();
    } else if (res.status === 409) {
      setActionError("This application has already been actioned by another committee member.");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || "Failed to approve application.");
    }

    setProcessing(null);
    setShowHoldExpiredConfirm(null);
  }

  async function handleDecline(memberId: string) {
    setProcessing(memberId);
    setActionError(null);

    const res = await fetch("/api/admin/applications/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, notes: declineNotes }),
    });

    if (res.ok) {
      setShowDeclineModal(null);
      setDeclineNotes("");
      router.refresh();
    } else if (res.status === 409) {
      setActionError("This application has already been actioned by another committee member.");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || "Failed to decline application.");
    }

    setProcessing(null);
  }

  return (
    <div>
      {/* Global messages */}
      {actionError && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}
      {actionMessage && (
        <div className="mb-4 p-4 bg-sky/10 border border-sky/20 rounded-lg text-sm text-marine font-body">
          {actionMessage}
          <button onClick={() => setActionMessage(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

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

        {filtered.map((app) => {
          const payment = paymentMap[app.id];
          const isHoldExpired = payment?.payment_capture_status === "hold_expired";

          return (
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
                <div className="flex items-center gap-2">
                  {payment && (
                    <PaymentStatusBadge status={payment.payment_capture_status} />
                  )}
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
              </div>

              {/* Hold expired warning */}
              {isHoldExpired && app.status === "pending" && (
                <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm font-body text-orange-800">
                    <strong>Payment hold expired.</strong> If approved, the
                    applicant&apos;s card will be charged directly. The charge may fail
                    if the card has insufficient funds or has expired.
                  </p>
                </div>
              )}

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

              {/* Capture window info */}
              {payment?.payment_capture_status === "authorized" && payment.capture_before && (
                <div className="mb-4 text-xs text-muted-foreground font-body">
                  Hold expires:{" "}
                  {new Date(payment.capture_before).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              )}

              {app.originator_note && (
                <div className="bg-cream rounded-lg p-3 mb-4">
                  <p className="text-xs text-muted-foreground font-body mb-1">
                    Originator note
                  </p>
                  <p className="text-sm font-body text-marine">
                    {app.originator_note}
                  </p>
                </div>
              )}

              {app.status === "pending" && (
                <div className="flex gap-3">
                  {isHoldExpired ? (
                    <button
                      onClick={() => setShowHoldExpiredConfirm(app.id)}
                      disabled={processing === app.id}
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-body font-medium hover:bg-orange-700 transition-colors disabled:opacity-50"
                    >
                      {processing === app.id ? "Processing..." : "Approve (Hold Expired)"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleApprove(app.id)}
                      disabled={processing === app.id}
                      className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
                    >
                      {processing === app.id ? "Processing..." : "Approve"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowDeclineModal(app.id)}
                    disabled={processing === app.id}
                    className="px-4 py-2 bg-white text-destructive border border-destructive/30 rounded-lg text-sm font-body font-medium hover:bg-destructive/5 transition-colors disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              )}

              {/* Hold expired confirmation */}
              {showHoldExpiredConfirm === app.id && (
                <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <p className="text-sm font-body text-orange-800 mb-3">
                    The payment hold has expired. Approving will attempt to charge
                    the applicant&apos;s card directly. If the charge fails, the
                    applicant will receive an email with a retry link.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(app.id)}
                      disabled={processing === app.id}
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-body font-medium hover:bg-orange-700 transition-colors disabled:opacity-50"
                    >
                      {processing === app.id ? "Processing..." : "Confirm Approve"}
                    </button>
                    <button
                      onClick={() => setShowHoldExpiredConfirm(null)}
                      className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine"
                    >
                      Cancel
                    </button>
                  </div>
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
          );
        })}
      </div>
    </div>
  );
}
