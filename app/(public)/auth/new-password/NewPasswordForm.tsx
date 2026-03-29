"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    window.location.href = "/auth/session";
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-body font-medium text-marine mb-1.5"
        >
          New password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
        />
      </div>
      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-body font-medium text-marine mb-1.5"
        >
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="••••••••"
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
        />
      </div>
      {error && <p className="text-sm text-destructive font-body">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving..." : "Set Password"}
      </button>
    </form>
  );
}
