"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAwaitingPayment } from "@/lib/members/status";

interface Address {
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

interface Member {
  id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: Address | null;
  company_name: string | null;
  company_role: string | null;
  member_number: string | null;
  tier_id: string;
  status: string;
  originator_id: string | null;
  originator_note: string | null;
  approved_at: string | null;
  start_date: string | null;
  end_date: string | null;
  profile_photo_url: string | null;
  metadata: unknown;
  created_at: string;
}

interface Originator {
  id: string;
  first_name: string;
  last_name: string;
}

interface MemberDetailProps {
  member: Member;
  tierMap: Record<string, { name: string; price_eur: number }>;
  originatorMap: Record<string, string>;
  payments: Record<string, unknown>[];
  card: Record<string, unknown> | null;
  allTiers: Record<string, unknown>[];
  allOriginators: Originator[];
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-sky/20 text-sky-dark",
  expired: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-800",
  declined: "bg-red-50 text-red-600",
};

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: "CHF", minimumFractionDigits: 0 }).format(amount);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-0.5">{label}</p>
      <p className="font-body text-marine">{value || "—"}</p>
    </div>
  );
}

export default function MemberDetail({ member, tierMap, originatorMap, payments, card, allTiers, allOriginators }: MemberDetailProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(member.status);
  const [tierId, setTierId] = useState(member.tier_id);
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [renewalOriginatorId, setRenewalOriginatorId] = useState(allOriginators[0]?.id || "");
  const [renewalSending, setRenewalSending] = useState(false);
  const [renewalResult, setRenewalResult] = useState<{ success: boolean; message: string } | null>(null);
  const [resendingPaymentLink, setResendingPaymentLink] = useState(false);
  const [resendPaymentResult, setResendPaymentResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    await fetch("/api/admin/members/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: member.id, status, tier_id: tierId }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  async function handleRequestRenewal() {
    setRenewalSending(true);
    setRenewalResult(null);
    const res = await fetch("/api/admin/members/request-renewal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: member.id, originator_id: renewalOriginatorId }),
    });
    setRenewalSending(false);
    if (res.ok) {
      setRenewalResult({ success: true, message: `Renewal email sent to ${member.email}` });
    } else {
      const data = await res.json();
      setRenewalResult({ success: false, message: data.error || "Failed to send renewal email." });
    }
  }

  async function handleResendPaymentLink() {
    setResendingPaymentLink(true);
    setResendPaymentResult(null);
    try {
      const res = await fetch("/api/email/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id }),
      });
      if (res.ok) {
        setResendPaymentResult({ success: true, message: `Payment link sent to ${member.email}` });
        router.refresh();
      } else {
        const data = await res.json();
        setResendPaymentResult({ success: false, message: data.error || "Failed to send payment link." });
      }
    } catch {
      setResendPaymentResult({ success: false, message: "Network error. Please try again." });
    }
    setResendingPaymentLink(false);
  }

  const [showHonoraryConfirm, setShowHonoraryConfirm] = useState(false);
  const [honoraryResult, setHonoraryResult] = useState<string | null>(null);

  async function handleRenewHonorary() {
    setSaving(true);
    setHonoraryResult(null);
    const res = await fetch("/api/admin/members/renew-honorary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: member.id }),
    });
    if (res.ok) {
      setShowHonoraryConfirm(false);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setHonoraryResult(data.error || "Failed to renew as honorary.");
    }
    setSaving(false);
  }

  const address = member.address as Address | null;

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/members" className="text-sm text-muted-foreground hover:text-marine font-body">
          &larr; Members
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-border p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                {member.profile_photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.profile_photo_url}
                    alt={`${member.first_name} ${member.last_name}`}
                    className="w-16 h-16 rounded-full object-cover border border-border"
                  />
                )}
                <div>
                  <h1 className="font-heading text-2xl font-bold text-marine">
                    {member.title ? `${member.title} ` : ""}{member.first_name} {member.last_name}
                  </h1>
                  {member.member_number && (
                    <p className="text-sm font-accent uppercase tracking-wider text-sky-dark mt-0.5">
                      {member.member_number}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-body font-medium ${statusColors[member.status] || "bg-gray-100 text-gray-600"}`}>
                  {member.status}
                </span>
                {isAwaitingPayment(member.status) && (
                  <span className="px-3 py-1 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
                    Awaiting Payment
                  </span>
                )}
              </div>
            </div>

            {/* Contact & membership */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm mb-6">
              <Field label="Email" value={member.email} />
              <Field label="Phone" value={member.phone} />
              <Field label="Tier" value={
                editing ? (
                  <select value={tierId} onChange={(e) => setTierId(e.target.value)} className="mt-1 px-2 py-1 border border-border rounded text-sm font-body">
                    {allTiers.map((t: Record<string, unknown>) => (
                      <option key={String(t.id)} value={String(t.id)}>{String(t.name)}</option>
                    ))}
                  </select>
                ) : tierMap[member.tier_id]?.name
              } />
              <Field label="Status" value={
                editing ? (
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 px-2 py-1 border border-border rounded text-sm font-body">
                    {["pending","approved","active","expired","suspended","declined"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : <span className="capitalize">{member.status}</span>
              } />
              <Field label="Start Date" value={formatDate(member.start_date)} />
              <Field label="End Date" value={formatDate(member.end_date)} />
              <Field label="Approved" value={formatDate(member.approved_at)} />
              <Field label="Joined" value={formatDate(member.created_at)} />
            </div>

            {/* Company */}
            {(member.company_name || member.company_role) && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm mb-6 pt-4 border-t border-border">
                <Field label="Company" value={member.company_name} />
                <Field label="Role" value={member.company_role} />
              </div>
            )}

            {/* Address */}
            {address && Object.values(address).some(Boolean) && (
              <div className="text-sm mb-6 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-1">Address</p>
                <p className="font-body text-marine">
                  {[address.street, address.city, address.postal_code, address.country].filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            {/* Originator note */}
            {member.originator_note && (
              <div className="bg-cream rounded-lg p-3 mb-6">
                <p className="text-xs text-muted-foreground font-body mb-1">Originator note</p>
                <p className="text-sm font-body text-marine">{member.originator_note}</p>
              </div>
            )}

            {member.originator_id && (
              <div className="text-sm mb-6">
                <Field label="Referred by" value={originatorMap[member.originator_id] || "—"} />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-border">
              {editing ? (
                <>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50">
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button onClick={() => { setEditing(false); setStatus(member.status); setTierId(member.tier_id); }} className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setEditing(true)} className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors">
                    Edit
                  </button>
                  {member.status === "approved" && (
                    <button
                      onClick={handleResendPaymentLink}
                      disabled={resendingPaymentLink}
                      className="px-4 py-2 bg-sky-dark text-white rounded-lg text-sm font-body font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {resendingPaymentLink ? "Sending..." : "Resend Payment Link"}
                    </button>
                  )}
                  {member.status === "expired" && (
                    <>
                      <button
                        onClick={() => { setShowRenewalModal(true); setRenewalResult(null); }}
                        className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
                      >
                        Request Renewal
                      </button>
                      <button
                        onClick={() => { setShowHonoraryConfirm(true); setHonoraryResult(null); }}
                        className="px-4 py-2 bg-gray-200 text-marine rounded-lg text-sm font-body font-medium hover:bg-gray-300 transition-colors"
                      >
                        Renew as Honorary
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            {resendPaymentResult && (
              <p className={`text-sm font-body mt-3 ${resendPaymentResult.success ? "text-green-700" : "text-red-600"}`}>
                {resendPaymentResult.message}
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Card */}
          {card ? (
            <div className="bg-white rounded-xl border border-border p-6">
              <h3 className="font-body font-semibold text-marine mb-3">Digital Card</h3>
              <p className="text-xs text-muted-foreground font-body uppercase tracking-wide">Card Number</p>
              <p className="font-accent text-lg uppercase tracking-wider text-marine mb-2">{card.card_number as string}</p>
              <div className="text-sm font-body text-muted-foreground space-y-1">
                <p>From: {formatDate(card.valid_from as string)}</p>
                <p>Until: {formatDate(card.valid_until as string)}</p>
                <p>Active: {(card.is_active as boolean) ? "Yes" : "No"}</p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-border p-6">
              <h3 className="font-body font-semibold text-marine mb-2">Digital Card</h3>
              <p className="text-sm text-muted-foreground font-body">No card issued yet. Use &ldquo;Activate as Free Member&rdquo; or process a payment to generate a card.</p>
            </div>
          )}

          {/* Payments */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h3 className="font-body font-semibold text-marine mb-3">Payment History</h3>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground font-body">No payments recorded.</p>
            ) : (
              <div className="space-y-3">
                {payments.map((p) => (
                  <div key={p.id as string} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-body text-marine">{formatPrice(p.amount_eur as number)}</p>
                      <p className="text-xs text-muted-foreground font-body">{new Date(p.created_at as string).toLocaleDateString("en-GB")}</p>
                    </div>
                    <span className="text-xs font-body capitalize text-muted-foreground">{p.payment_status as string}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Renewal Modal */}
      {showRenewalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl border border-border p-6 w-full max-w-sm">
            <h2 className="font-heading text-lg font-bold text-marine mb-4">Request Renewal</h2>
            <p className="text-sm font-body text-muted-foreground mb-4">
              Select the originator link to use for this renewal. This controls whether the Honorary tier is offered.
            </p>

            <label className="block text-xs font-body uppercase tracking-wide text-muted-foreground mb-1">
              Originator
            </label>
            <select
              value={renewalOriginatorId}
              onChange={(e) => setRenewalOriginatorId(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body text-marine mb-4"
            >
              {allOriginators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.first_name} {o.last_name}
                </option>
              ))}
            </select>

            {renewalResult && (
              <p className={`text-sm font-body mb-4 ${renewalResult.success ? "text-green-700" : "text-red-600"}`}>
                {renewalResult.message}
              </p>
            )}

            <div className="flex gap-3">
              {!renewalResult?.success && (
                <button
                  onClick={handleRequestRenewal}
                  disabled={renewalSending || !renewalOriginatorId}
                  className="flex-1 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
                >
                  {renewalSending ? "Sending..." : "Send Renewal Email"}
                </button>
              )}
              <button
                onClick={() => setShowRenewalModal(false)}
                className="flex-1 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors"
              >
                {renewalResult?.success ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Honorary renewal confirmation */}
      {showHonoraryConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full space-y-4">
            <h2 className="font-heading text-lg font-bold text-marine">Renew as Honorary Member</h2>
            <p className="text-sm text-muted-foreground font-body">
              This will activate <strong>{member.first_name} {member.last_name}</strong> as an Honorary Member
              for one year with no payment. They will receive a welcome email with their membership card.
            </p>
            {honoraryResult && (
              <p className="text-sm text-destructive font-body">{honoraryResult}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleRenewHonorary}
                disabled={saving}
                className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-body font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Activating..." : "Confirm"}
              </button>
              <button
                onClick={() => setShowHonoraryConfirm(false)}
                className="flex-1 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
