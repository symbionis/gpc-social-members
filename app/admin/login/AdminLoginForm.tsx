"use client";

import { useState } from "react";
import { sendAdminMagicLink } from "./actions";
import { useSearchParams } from "next/navigation";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const redirectTo = `${window.location.origin}/auth/confirm`;
    const result = await sendAdminMagicLink(email, redirectTo);

    setLoading(false);

    if (result.error) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <div className="w-14 h-14 bg-sky/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-sky-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <h2 className="font-heading text-xl font-bold text-white">Check your email</h2>
        <p className="text-sm text-white/70 font-body">
          We sent a sign-in link to <span className="font-medium text-white">{email}</span>.
        </p>
        <button
          onClick={() => { setSent(false); setEmail(""); }}
          className="text-sm text-sky-light hover:text-white font-body underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      {errorParam === "unauthorized" && (
        <div className="mb-6 p-4 bg-white/10 border border-white/20 rounded-lg text-sm text-white/80 font-body">
          You do not have admin access. Please contact a super administrator.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="admin-email"
            className="block text-sm font-body font-medium text-white/80 mb-1.5"
          >
            Admin email address
          </label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="admin@genevapolo.com"
            className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 text-white font-body text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
        {error && (
          <p className="text-sm text-red-300 font-body">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-sky text-marine rounded-lg font-body font-medium text-sm hover:bg-sky-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Sending link..." : "Send Sign-In Link"}
        </button>
      </form>
    </>
  );
}
