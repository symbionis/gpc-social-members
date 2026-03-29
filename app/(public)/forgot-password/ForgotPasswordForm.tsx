"use client";

import { useState } from "react";
import Link from "next/link";
import { sendPasswordReset } from "@/app/actions/auth";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await sendPasswordReset(email, `${window.location.origin}/auth/confirm`);

    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="bg-sky/10 border border-sky/30 rounded-lg p-6 text-center">
        <h2 className="font-heading text-xl font-bold text-marine mb-2">
          Check your email
        </h2>
        <p className="text-sm text-muted-foreground font-body">
          If an account exists for <strong className="text-marine">{email}</strong>,
          you will receive a password reset link shortly.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-sky-dark hover:text-marine font-body underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-body font-medium text-marine mb-1.5"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="your@email.com"
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
        />
      </div>
      {error && <p className="text-sm text-destructive font-body">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending..." : "Send Reset Link"}
      </button>
      <p className="text-center text-sm font-body text-muted-foreground">
        <Link href="/login" className="text-sky-dark hover:text-marine underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
