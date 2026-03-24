"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProfileFormProps {
  member: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    company_name: string | null;
    company_role: string | null;
  };
}

export default function ProfileForm({ member }: ProfileFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/member/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: form.get("first_name"),
        last_name: form.get("last_name"),
        phone: form.get("phone") || null,
        company_name: form.get("company_name") || null,
        company_role: form.get("company_role") || null,
      }),
    });

    setSaving(false);

    if (res.ok) {
      setSuccess(true);
      router.refresh();
    } else {
      setError("Failed to update profile. Please try again.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-border p-6 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="first_name"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            First Name
          </label>
          <input
            id="first_name"
            name="first_name"
            type="text"
            defaultValue={member.first_name}
            required
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
          />
        </div>
        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Last Name
          </label>
          <input
            id="last_name"
            name="last_name"
            type="text"
            defaultValue={member.last_name}
            required
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-body font-medium text-marine mb-1.5">
          Email
        </label>
        <input
          type="email"
          value={member.email}
          disabled
          className="w-full px-4 py-3 rounded-lg border border-border bg-cream text-muted-foreground font-body text-sm cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground font-body mt-1">
          Contact the club to change your email address.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={member.phone || ""}
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
          />
        </div>
        <div>
          <label
            htmlFor="company_name"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Company
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            defaultValue={member.company_name || ""}
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="company_role"
          className="block text-sm font-body font-medium text-marine mb-1.5"
        >
          Role
        </label>
        <input
          id="company_role"
          name="company_role"
          type="text"
          defaultValue={member.company_role || ""}
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive font-body">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-700 font-body">
          Profile updated successfully.
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-6 py-3 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
