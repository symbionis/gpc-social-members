"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Tier {
  id: string;
  name: string;
  price_cents: number;
  category: string;
  stripe_price_id: string | null;
  benefits: unknown;
  guest_invitation_limit: number;
  is_active: boolean;
}

interface TierManagerProps {
  tiers: Tier[];
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export default function TierManager({ tiers }: TierManagerProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<Partial<Tier>>({});

  function startEdit(tier: Tier) {
    setEditing(tier.id);
    setEditData({
      name: tier.name,
      price_cents: tier.price_cents,
      guest_invitation_limit: tier.guest_invitation_limit,
      stripe_price_id: tier.stripe_price_id,
      is_active: tier.is_active,
    });
  }

  async function handleSave(tierId: string) {
    setSaving(true);
    await fetch("/api/admin/tiers/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier_id: tierId, ...editData }),
    });
    setSaving(false);
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {tiers.map((tier) => (
        <div
          key={tier.id}
          className={`bg-white rounded-xl border p-6 ${
            tier.is_active ? "border-border" : "border-border/50 opacity-60"
          }`}
        >
          {editing === tier.id ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-body text-muted-foreground mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={editData.name || ""}
                    onChange={(e) =>
                      setEditData({ ...editData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body"
                  />
                </div>
                <div>
                  <label className="block text-xs font-body text-muted-foreground mb-1">
                    Price (EUR cents)
                  </label>
                  <input
                    type="number"
                    value={editData.price_cents || 0}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        price_cents: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body"
                  />
                </div>
                <div>
                  <label className="block text-xs font-body text-muted-foreground mb-1">
                    Guest Invitation Limit
                  </label>
                  <input
                    type="number"
                    value={editData.guest_invitation_limit || 0}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        guest_invitation_limit: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body"
                  />
                </div>
                <div>
                  <label className="block text-xs font-body text-muted-foreground mb-1">
                    Stripe Price ID
                  </label>
                  <input
                    type="text"
                    value={editData.stripe_price_id || ""}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        stripe_price_id: e.target.value || null,
                      })
                    }
                    placeholder="price_..."
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-body">
                  <input
                    type="checkbox"
                    checked={editData.is_active ?? true}
                    onChange={(e) =>
                      setEditData({ ...editData, is_active: e.target.checked })
                    }
                  />
                  Active
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave(tier.id)}
                  disabled={saving}
                  className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-body font-semibold text-marine text-lg">
                    {tier.name}
                  </h3>
                  <span className="px-2 py-0.5 bg-cream rounded text-xs font-body text-muted-foreground capitalize">
                    {tier.category}
                  </span>
                  {!tier.is_active && (
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-body text-gray-500">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground font-body">
                  <span>{formatPrice(tier.price_cents)}</span>
                  <span>
                    {tier.guest_invitation_limit} guest
                    {tier.guest_invitation_limit !== 1 ? "s" : ""}
                  </span>
                  {tier.stripe_price_id && (
                    <span className="text-xs font-mono">
                      {tier.stripe_price_id}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => startEdit(tier)}
                className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body hover:bg-cream transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
