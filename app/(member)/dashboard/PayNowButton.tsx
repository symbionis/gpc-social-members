"use client";

import { useState } from "react";
import { createMemberCheckoutSession } from "./actions";

export default function PayNowButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const result = await createMemberCheckoutSession();
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
        className="w-full py-2.5 bg-sky-dark text-white rounded-lg font-body font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting to payment..." : "Complete Payment →"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-destructive font-body">{error}</p>
      )}
    </div>
  );
}
