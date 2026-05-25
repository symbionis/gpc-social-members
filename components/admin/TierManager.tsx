"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";

interface Tier {
  id: string;
  name: string;
  price_eur: number;
  category: string;
  benefits: unknown;
  guest_invitations_per_season: number;
  is_active: boolean;
}

interface TierManagerProps {
  tiers: Tier[];
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
      price_eur: tier.price_eur,
      guest_invitations_per_season: tier.guest_invitations_per_season,
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
                    Price (CHF)
                  </label>
                  <input
                    type="number"
                    value={editData.price_eur || 0}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        price_eur: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm font-body"
                  />
                </div>
                <div>
                  <label className="block text-xs font-body text-muted-foreground mb-1">
                    Guest Invitations per Season
                  </label>
                  <input
                    type="number"
                    value={editData.guest_invitations_per_season || 0}
                    onChange={(e) =>
                      setEditData({
                        ...editData,
                        guest_invitations_per_season: parseInt(e.target.value),
                      })
                    }
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
                  <span>{formatCurrency(tier.price_eur)}</span>
                  <span>
                    {tier.guest_invitations_per_season} guest
                    {tier.guest_invitations_per_season !== 1 ? "s" : ""}
                  </span>
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
