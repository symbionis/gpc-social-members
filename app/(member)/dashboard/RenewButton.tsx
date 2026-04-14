"use client";

import { useState } from "react";
import { createRenewalCheckoutSession } from "./actions";

export default function RenewButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const result = await createRenewalCheckoutSession();
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    if (result.url) {
      window.location.href = result.url;
    }
  }

  return (
    <div className="mt-4">
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full py-2.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting to payment..." : "Renew Membership"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-destructive font-body">{error}</p>
      )}
    </div>
  );
}
