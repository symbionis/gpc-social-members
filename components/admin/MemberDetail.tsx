"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Member {
  id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  company_role: string | null;
  member_number: string | null;
  tier_id: string;
  status: string;
  originator_id: string | null;
  originator_note: string | null;
  metadata: unknown;
  created_at: string;
}

interface MemberDetailProps {
  member: Member;
  tierMap: Record<string, { name: string; price_eur: number }>;
  originatorMap: Record<string, string>;
  payments: Record<string, unknown>[];
  card: Record<string, unknown> | null;
  allTiers: Record<string, unknown>[];
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-sky/20 text-sky-dark",
  expired: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-800",
  declined: "bg-red-50 text-red-600",
};

function formatPrice(eur: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(eur);
}

export default function MemberDetail({
  member,
  tierMap,
  originatorMap,
  payments,
  card,
  allTiers,
}: MemberDetailProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(member.status);
  const [tierId, setTierId] = useState(member.tier_id);

  async function handleSave() {
    setSaving(true);
    await fetch("/api/admin/members/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_id: member.id,
        status,
        tier_id: tierId,
      }),
    });
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  async function handleActivateFree() {
    setSaving(true);
    await fetch("/api/admin/members/activate-free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: member.id }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin/members"
          className="text-sm text-muted-foreground hover:text-marine font-body"
        >
          &larr; Members
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-border p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="font-heading text-2xl font-bold text-marine">
                {member.title ? `${member.title} ` : ""}
                {member.first_name} {member.last_name}
              </h1>
              <p className="text-sm text-muted-foreground font-body mt-1">
                {member.email}
                {member.phone && ` · ${member.phone}`}
              </p>
              {member.member_number && (
                <p className="text-sm font-accent uppercase tracking-wider text-sky-dark mt-1">
                  {member.member_number}
                </p>
              )}
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-body font-medium ${statusColors[member.status] || "bg-gray-100 text-gray-600"}`}
            >
              {member.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-6">
            <div>
              <p className="text-muted-foreground font-body">Tier</p>
              {editing ? (
                <select
                  value={tierId}
                  onChange={(e) => setTierId(e.target.value)}
                  className="mt-1 px-2 py-1 border border-border rounded text-sm font-body"
                >
                  {allTiers.map((t: Record<string, unknown>) => (
                    <option key={String(t.id)} value={String(t.id)}>
                      {String(t.name)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="font-body font-medium text-marine">
                  {tierMap[member.tier_id]?.name || "—"}
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground font-body">Status</p>
              {editing ? (
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 px-2 py-1 border border-border rounded text-sm font-body"
                >
                  {[
                    "pending",
                    "approved",
                    "active",
                    "expired",
                    "suspended",
                    "declined",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="font-body font-medium text-marine capitalize">
                  {member.status}
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground font-body">Originator</p>
              <p className="font-body font-medium text-marine">
                {member.originator_id
                  ? originatorMap[member.originator_id] || "—"
                  : "—"}
              </p>
            </div>
            {member.company_name && (
              <div>
                <p className="text-muted-foreground font-body">Company</p>
                <p className="font-body font-medium text-marine">
                  {member.company_name}
                </p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground font-body">Joined</p>
              <p className="font-body font-medium text-marine">
                {new Date(member.created_at).toLocaleDateString(
                  "en-GB"
                )}
              </p>
            </div>
          </div>

          {member.originator_note && (
            <div className="bg-cream rounded-lg p-3 mb-6">
              <p className="text-xs text-muted-foreground font-body mb-1">
                Originator note
              </p>
              <p className="text-sm font-body text-marine">
                {member.originator_note}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setStatus(member.status);
                    setTierId(member.tier_id);
                  }}
                  className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body font-medium hover:bg-cream transition-colors"
                >
                  Edit
                </button>
                {member.status === "approved" && (
                  <button
                    onClick={handleActivateFree}
                    disabled={saving}
                    className="px-4 py-2 bg-sky text-marine rounded-lg text-sm font-body font-medium hover:bg-sky-light transition-colors disabled:opacity-50"
                  >
                    Activate as Free Member
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Card info */}
          {card && (
            <div className="bg-white rounded-xl border border-border p-6">
              <h3 className="font-body font-semibold text-marine mb-3">
                Digital Card
              </h3>
              <p className="text-sm font-body text-muted-foreground">
                Card Number
              </p>
              <p className="font-accent text-lg uppercase tracking-wider text-marine">
                {card.card_number as string}
              </p>
              <div className="mt-2 text-sm font-body text-muted-foreground">
                <p>Valid: {card.valid_from as string} — {card.valid_until as string}</p>
                <p>Active: {(card.is_active as boolean) ? "Yes" : "No"}</p>
              </div>
            </div>
          )}

          {/* Payments */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h3 className="font-body font-semibold text-marine mb-3">
              Payment History
            </h3>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground font-body">
                No payments recorded.
              </p>
            ) : (
              <div className="space-y-3">
                {payments.map((p) => (
                  <div
                    key={p.id as string}
                    className="flex items-center justify-between text-sm"
                  >
                    <div>
                      <p className="font-body text-marine">
                        {formatPrice(p.amount_eur as number)}
                      </p>
                      <p className="text-xs text-muted-foreground font-body">
                        {new Date(p.created_at as string).toLocaleDateString(
                          "en-GB"
                        )}
                      </p>
                    </div>
                    <span className="text-xs font-body capitalize text-muted-foreground">
                      {p.payment_status as string}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
