"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <>
      {errorParam === "unauthorized" && (
        <div className="mb-6 p-4 bg-white/10 border border-white/20 rounded-lg text-sm text-white/80 font-body">
          You do not have admin access. Please contact a super administrator.
        </div>
      )}

      {sent ? (
        <div className="bg-white/10 border border-white/20 rounded-lg p-6 text-center">
          <h2 className="font-heading text-xl font-bold text-white mb-2">
            Check your email
          </h2>
          <p className="text-sm text-white/70 font-body">
            We&apos;ve sent a login link to{" "}
            <strong className="text-sky">{email}</strong>.
          </p>
          <button
            onClick={() => setSent(false)}
            className="mt-4 text-sm text-sky hover:text-sky-light font-body underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
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
            <p className="text-sm text-accent-red font-body">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-sky text-marine rounded-lg font-body font-medium text-sm hover:bg-sky-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Sending link..." : "Send Login Link"}
          </button>
        </form>
      )}
    </>
  );
}
