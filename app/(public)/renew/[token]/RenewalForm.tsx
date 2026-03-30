"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Tier {
  id: string;
  name: string;
  price_eur: number;
  benefits: unknown;
  guest_invitations_per_season: number;
}

interface RenewalFormProps {
  token: string;
  tiers: Tier[];
}

function formatPrice(eur: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
  }).format(eur);
}

export default function RenewalForm({ token, tiers }: RenewalFormProps) {
  const router = useRouter();
  const [selectedTierId, setSelectedTierId] = useState(tiers[0]?.id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTierId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/renew/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, tier_id: selectedTierId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      if (data.activated) {
        router.push("/login?payment=success");
        return;
      }

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tiers.length === 0) {
    return (
      <div className="text-center text-muted-foreground font-body">
        No membership tiers available at this time.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-border p-8">
      <fieldset className="mb-8">
        <legend className="block text-sm font-body font-medium text-marine mb-3">
          Select Membership Tier
        </legend>
        <div className="grid gap-3">
          {tiers.map((tier) => (
            <label
              key={tier.id}
              className={`relative flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                selectedTierId === tier.id
                  ? "border-sky bg-sky/5"
                  : "border-border hover:border-sky/50"
              }`}
            >
              <input
                type="radio"
                name="tier_id"
                value={tier.id}
                checked={selectedTierId === tier.id}
                onChange={() => setSelectedTierId(tier.id)}
                className="sr-only"
              />
              <div>
                <span className="font-body font-medium text-marine">
                  {tier.name}
                </span>
                {(tier.guest_invitations_per_season ?? 0) > 0 && (
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Includes {tier.guest_invitations_per_season} guest invitation
                    {tier.guest_invitations_per_season !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <span className="font-body font-semibold text-marine">
                {tier.price_eur === 0 ? "Honorary" : formatPrice(tier.price_eur)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="text-sm text-red-600 font-body mb-4">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !selectedTierId}
        className="w-full py-3 bg-marine text-white rounded-lg font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
      >
        {loading ? "Processing..." : "Proceed to Payment"}
      </button>
    </form>
  );
}
