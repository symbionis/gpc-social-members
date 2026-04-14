"use client";

import { useState } from "react";
import { submitApplication } from "@/app/(public)/apply/[invite_code]/actions";
import { useRouter } from "next/navigation";
import PaymentSection from "./PaymentSection";
import { DIAL_CODES } from "@/lib/dial-codes";
import type { Database } from "@/types/database";

type TierRow = Database["public"]["Tables"]["membership_tiers"]["Row"];
type Tier = Pick<TierRow, "id" | "name" | "price_eur" | "benefits" | "guest_invitations_per_season">;

interface ApplicationFormProps {
  originatorId: string;
  individualTiers: Tier[];
  corporateTiers: Tier[];
  resumeMemberId?: string | null;
  resumeTierId?: string | null;
  isHonorary?: boolean;
  honoParam?: string;
}

function formatPrice(eur: number): string {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
  }).format(eur);
}

function TierSelector({
  tiers,
  selectedTier,
  onChange,
}: {
  tiers: Tier[];
  selectedTier: string;
  onChange: (id: string) => void;
}) {
  return (
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
              onChange={() => onChange(tier.id)}
              className="sr-only"
            />
            <div>
              <span className="font-body font-medium text-marine">
                {tier.name}
              </span>
              {tier.guest_invitations_per_season > 0 && (
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
    </fieldset>
  );
}

export default function ApplicationForm({
  originatorId,
  individualTiers,
  corporateTiers,
  resumeMemberId,
  resumeTierId,
  isHonorary,
  honoParam,
}: ApplicationFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"individual" | "corporate">("individual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const [selectedIndividualTier, setSelectedIndividualTier] = useState(
    (resumeTierId && individualTiers.some(t => t.id === resumeTierId) ? resumeTierId : individualTiers[0]?.id) || ""
  );
  const [selectedCorporateTier, setSelectedCorporateTier] = useState(
    (resumeTierId && corporateTiers.some(t => t.id === resumeTierId) ? resumeTierId : corporateTiers[0]?.id) || ""
  );

  // Payment step state — skip to payment if resuming
  const [step, setStep] = useState<"form" | "payment">(resumeMemberId ? "payment" : "form");
  const [memberId, setMemberId] = useState<string | null>(resumeMemberId || null);
  const [paymentError, setPaymentError] = useState<string>("");
  const [dialCode, setDialCode] = useState("+41");

  const selectedTier = activeTab === "individual" ? selectedIndividualTier : selectedCorporateTier;
  const allTiers = [...individualTiers, ...corporateTiers];
  const currentTier = allTiers.find((t) => t.id === selectedTier);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const firstName = form.get("first_name") as string;
    const lastName = form.get("last_name") as string;
    const title = form.get("title") as string;
    const localPhone = (form.get("phone") as string).replace(/^0/, "");
    const phone = localPhone ? `${dialCode}${localPhone}` : "";
    const companyName = form.get("company_name") as string;
    const companyRole = form.get("company_role") as string;
    const originatorNote = form.get("originator_note") as string;
    const linkedinUrl = (form.get("linkedin_url") as string).trim();

    if (linkedinUrl && !/^https?:\/\/(www\.)?linkedin\.com\/.+/.test(linkedinUrl)) {
      setLinkedinError("Please enter a valid LinkedIn URL (e.g. https://linkedin.com/in/yourname)");
      setLoading(false);
      return;
    }
    setLinkedinError(null);

    const result = await submitApplication({
      email,
      firstName,
      lastName,
      title,
      phone,
      companyName,
      companyRole,
      originatorNote,
      linkedinUrl,
      tierId: selectedTier,
      originatorId,
      consentGivenAt: new Date().toISOString(),
      honoParam: honoParam || undefined,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    // Free tier (honorary): skip payment, go straight to success
    if (currentTier && currentTier.price_eur === 0) {
      router.push("/apply/success");
      return;
    }

    // Move to payment step
    setMemberId(result.member_id);
    setStep("payment");
  }

  function handlePaymentSuccess() {
    router.push("/apply/success");
  }

  const isCorporate = activeTab === "corporate";

  if (step === "payment" && memberId && currentTier) {
    return (
      <div className="space-y-6">
        <div className="p-4 bg-sky/5 border border-sky/20 rounded-lg">
          <p className="text-sm font-body text-marine">
            <strong>Application submitted.</strong> Please authorize payment to
            complete your application.
          </p>
        </div>

        <div className="flex items-center justify-between p-4 rounded-lg border border-border">
          <span className="font-body text-sm text-marine">{currentTier.name}</span>
          <span className="font-body font-semibold text-marine">
            {formatPrice(currentTier.price_eur)}
          </span>
        </div>

        {paymentError && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive font-body">
            {paymentError}
          </div>
        )}

        <PaymentSection
          amount={currentTier.price_eur}
          memberId={memberId}
          onSuccess={handlePaymentSuccess}
          onError={setPaymentError}
        />

        <p className="text-xs text-center text-muted-foreground font-body">
          Your card will only be charged if your application is approved by the
          membership committee.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Tab switcher — hide for honorary (single tier, no choice needed) */}
      {!isHonorary && (
        <div className="flex rounded-lg border border-border overflow-hidden mb-8">
          <button
            type="button"
            onClick={() => { setActiveTab("individual"); setError(null); }}
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
            onClick={() => { setActiveTab("corporate"); setError(null); }}
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Tier Selection — hide for honorary (auto-selected) */}
        {isHonorary ? null : activeTab === "individual" ? (
          <TierSelector
            tiers={individualTiers}
            selectedTier={selectedIndividualTier}
            onChange={setSelectedIndividualTier}
          />
        ) : (
          <TierSelector
            tiers={corporateTiers}
            selectedTier={selectedCorporateTier}
            onChange={setSelectedCorporateTier}
          />
        )}

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
            <div className="flex gap-2">
              <select
                value={dialCode}
                onChange={(e) => setDialCode(e.target.value)}
                className="w-36 shrink-0 px-3 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
              >
                {DIAL_CODES.map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
              <input
                id="phone"
                name="phone"
                type="tel"
                placeholder="79 123 45 67"
                className="flex-1 px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="company_name"
              className="block text-sm font-body font-medium text-marine mb-1.5"
            >
              Company {isCorporate ? "*" : ""}
            </label>
            <input
              id="company_name"
              name="company_name"
              type="text"
              required={isCorporate}
              className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            />
          </div>
          <div>
            <label
              htmlFor="company_role"
              className="block text-sm font-body font-medium text-marine mb-1.5"
            >
              Role {isCorporate ? "*" : ""}
            </label>
            <input
              id="company_role"
              name="company_role"
              type="text"
              required={isCorporate}
              className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="originator_note"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            How do you know your host, and why do you wish to become a member? *
          </label>
          <textarea
            id="originator_note"
            name="originator_note"
            required
            rows={3}
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky resize-none"
            placeholder="A brief note about your connection..."
          />
        </div>

        <div>
          <label
            htmlFor="linkedin_url"
            className="block text-sm font-body font-medium text-marine mb-1.5"
          >
            LinkedIn Profile
          </label>
          <input
            id="linkedin_url"
            name="linkedin_url"
            type="url"
            className="w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            placeholder="https://linkedin.com/in/yourname"
          />
          {linkedinError && (
            <p className="mt-1.5 text-xs text-destructive font-body">{linkedinError}</p>
          )}
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="terms_agreed"
            required
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-sky-dark focus:ring-sky/50"
          />
          <span className="font-body text-sm text-marine/70 leading-relaxed">
            In submitting my application I agree to the{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 text-marine hover:text-sky-dark transition-colors"
            >
              General Terms &amp; Conditions
            </a>
            .
          </span>
        </label>

        {/* Payment consent checkbox — hide for free/honorary tiers */}
        {currentTier && currentTier.price_eur > 0 && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="payment_consent"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-sky-dark focus:ring-sky/50"
            />
            <span className="font-body text-sm text-marine/70 leading-relaxed">
              I authorize a hold of{" "}
              <strong className="text-marine">
                {formatPrice(currentTier.price_eur)}
              </strong>{" "}
              on my card. This amount will only be charged if my application is
              approved by the membership committee. If declined, the hold will be
              released.
            </span>
          </label>
        )}

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
          {loading ? "Submitting..." : isHonorary ? "Submit Application" : "Authorize Hold"}
        </button>

        <p className="text-xs text-center text-muted-foreground font-body">
          Your application will be reviewed by our membership committee. You
          will receive an email once a decision has been made.
        </p>
      </form>
    </div>
  );
}
