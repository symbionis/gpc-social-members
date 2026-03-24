"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface Tier {
  id: string;
  name: string;
  price_cents: number;
  benefits: unknown;
  guest_invitation_limit: number;
}

interface ApplicationFormProps {
  originatorId: string;
  tiers: Tier[];
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export default function ApplicationForm({
  originatorId,
  tiers,
}: ApplicationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState(tiers[0]?.id || "");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const firstName = form.get("first_name") as string;
    const lastName = form.get("last_name") as string;
    const title = form.get("title") as string;
    const phone = form.get("phone") as string;
    const company = form.get("company") as string;
    const roleTitle = form.get("role_title") as string;
    const connectionNote = form.get("connection_note") as string;

    const supabase = createClient();

    // Check for duplicate email
    const { data: existing } = await supabase
      .from("members")
      .select("id, status")
      .eq("email", email)
      .limit(1);

    if (existing && existing.length > 0) {
      setLoading(false);
      const member = existing[0];
      if (member.status === "active") {
        setError("This email is already associated with an active membership.");
      } else if (member.status === "pending") {
        setError(
          "An application with this email is already under review."
        );
      } else {
        setError(
          "This email is already in our system. Please contact the club for assistance."
        );
      }
      return;
    }

    // Insert application
    const { error: insertError } = await supabase.from("members").insert({
      email,
      first_name: firstName,
      last_name: lastName,
      title: title || null,
      phone: phone || null,
      company: company || null,
      role_title: roleTitle || null,
      connection_note: connectionNote || null,
      tier_id: selectedTier,
      originator_id: originatorId,
      status: "pending",
      payment_status: "pending",
    });

    setLoading(false);

    if (insertError) {
      setError("Something went wrong. Please try again.");
      return;
    }

    router.push("/apply/success");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tier Selection */}
      <fieldset>
        <legend className="block text-sm font-body font-medium text-marine mb-3">
          Membership Tier
        </legend>
        <div className="grid gap-3">
          {tiers.map((tier) => (
            <label
              key={tier.id}
              className={`relative flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                selectedTier === tier.id
                  ? "border-sky bg-sky/5"
                  : "border-border hover:border-sky/50"
              }`}
            >
              <input
                type="radio"
                name="tier_id"
                value={tier.id}
                checked={selectedTier === tier.id}
                onChange={() => setSelectedTier(tier.id)}
                className="sr-only"
              />
              <div>
                <span className="font-body font-medium text-marine">
                  {tier.name}
                </span>
                {tier.guest_invitation_limit > 0 && (
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Includes {tier.guest_invitation_limit} guest invitation
                    {tier.guest_invitation_limit !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <span className="font-body font-semibold text-marine">
                {formatPrice(tier.price_cents)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Personal Details */}
      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr] gap-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Title
          </label>
          <select
            id="title"
            name="title"
            className="w-full px-3 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          >
            <option value="">—</option>
            <option value="Mr">Mr</option>
            <option value="Mrs">Mrs</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="first_name"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            First Name *
          </label>
          <input
            id="first_name"
            name="first_name"
            type="text"
            required
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Last Name *
          </label>
          <input
            id="last_name"
            name="last_name"
            type="text"
            required
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
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
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="company"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Company
          </label>
          <input
            id="company"
            name="company"
            type="text"
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
        <div>
          <label
            htmlFor="role_title"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            Role
          </label>
          <input
            id="role_title"
            name="role_title"
            type="text"
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="connection_note"
          className="block text-sm font-body font-medium text-marine mb-1.5"
        >
          How do you know your host? *
        </label>
        <textarea
          id="connection_note"
          name="connection_note"
          required
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky resize-none"
          placeholder="A brief note about your connection..."
        />
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Submitting..." : "Submit Application"}
      </button>

      <p className="text-xs text-center text-muted-foreground font-body">
        Your application will be reviewed by our membership committee. You will
        receive an email once a decision has been made.
      </p>
    </form>
  );
}
