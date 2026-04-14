"use client";

import { useState } from "react";

interface Tier {
  id: string;
  name: string;
  price_eur: number;
  benefits: unknown;
  guest_invitations_per_season: number;
}

interface MemberRenewalFormProps {
  memberId: string;
  currentTierId: string;
  currentCategory: "individual" | "corporate";
  individualTiers: Tier[];
  corporateTiers: Tier[];
}

function formatPrice(eur: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
  }).format(eur);
}

export default function MemberRenewalForm({
  memberId,
  currentTierId,
  currentCategory,
  individualTiers,
  corporateTiers,
}: MemberRenewalFormProps) {
  const showCorporateTab = currentCategory === "corporate" && corporateTiers.length > 0;
  const [activeTab, setActiveTab] = useState<"individual" | "corporate">(
    showCorporateTab ? "corporate" : "individual"
  );

  const [selectedIndividualTier, setSelectedIndividualTier] = useState(
    currentCategory === "individual" && individualTiers.some(t => t.id === currentTierId)
      ? currentTierId
      : individualTiers[0]?.id || ""
  );
  const [selectedCorporateTier, setSelectedCorporateTier] = useState(
    currentCategory === "corporate" && corporateTiers.some(t => t.id === currentTierId)
      ? currentTierId
      : corporateTiers[0]?.id || ""
  );

  const selectedTierId = activeTab === "individual" ? selectedIndividualTier : selectedCorporateTier;
  const allTiers = [...individualTiers, ...corporateTiers];
  const selectedTier = allTiers.find(t => t.id === selectedTierId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTierId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/renew/member-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, tier_id: selectedTierId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
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

  function TierList({ tiers, selected, onSelect }: { tiers: Tier[]; selected: string; onSelect: (id: string) => void }) {
    return (
      <div className="grid gap-3">
        {tiers.map((tier) => (
          <label
            key={tier.id}
            className={`relative flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-colors ${
              selected === tier.id
                ? "border-sky bg-sky/5"
                : "border-border hover:border-sky/50"
            }`}
          >
            <input
              type="radio"
              name="tier_id"
              value={tier.id}
              checked={selected === tier.id}
              onChange={() => onSelect(tier.id)}
              className="sr-only"
            />
            <div>
              <span className="font-body font-medium text-marine">
                {tier.name}
              </span>
              {tier.id === currentTierId && (
                <span className="ml-2 text-xs text-sky-dark font-body">Current</span>
              )}
              {(tier.guest_invitations_per_season ?? 0) > 0 && (
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Includes {tier.guest_invitations_per_season} guest invitation
                  {tier.guest_invitations_per_season !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <span className="font-body font-semibold text-marine">
              {formatPrice(tier.price_eur)}
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (individualTiers.length === 0 && corporateTiers.length === 0) {
    return (
      <div className="text-center text-muted-foreground font-body">
        No membership tiers available at this time.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-border p-8">
      {/* Tab switcher — only show if corporate member */}
      {showCorporateTab && (
        <div className="flex rounded-lg border border-border overflow-hidden mb-6">
          <button
            type="button"
            onClick={() => setActiveTab("individual")}
            className={`flex-1 py-3 text-sm font-body font-medium transition-colors ${
              activeTab === "individual"
                ? "bg-marine text-white"
                : "bg-white text-marine hover:bg-marine/5"
            }`}
          >
            Individual
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("corporate")}
            className={`flex-1 py-3 text-sm font-body font-medium transition-colors border-l border-border ${
              activeTab === "corporate"
                ? "bg-marine text-white"
                : "bg-white text-marine hover:bg-marine/5"
            }`}
          >
            Corporate
          </button>
        </div>
      )}

      <fieldset className="mb-8">
        <legend className="block text-sm font-body font-medium text-marine mb-3">
          Select Membership Tier
        </legend>
        {activeTab === "individual" ? (
          <TierList tiers={individualTiers} selected={selectedIndividualTier} onSelect={setSelectedIndividualTier} />
        ) : (
          <TierList tiers={corporateTiers} selected={selectedCorporateTier} onSelect={setSelectedCorporateTier} />
        )}
      </fieldset>

      {error && (
        <p className="text-sm text-destructive font-body mb-4">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || !selectedTierId}
        className="w-full py-3 bg-marine text-white rounded-lg font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
      >
        {loading ? "Processing..." : `Proceed to Payment — ${selectedTier ? formatPrice(selectedTier.price_eur) : ""}`}
      </button>
    </form>
  );
}
