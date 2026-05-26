"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  eventId: string;
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); may be empty in local dev. */
  baseUrl: string;
  /** Current secret code (events.invite_code); null = none generated yet. */
  inviteCode: string | null;
  /** Current guest price (events.invite_price); null = unset. */
  invitePrice: number | null;
  /** Whether registration is enabled for this event (set in the event editor). */
  registrationEnabled: boolean;
}

export default function EventInviteLink({
  eventId,
  baseUrl,
  inviteCode,
  invitePrice,
  registrationEnabled,
}: Props) {
  const router = useRouter();

  // Origin is build-time-stable when NEXT_PUBLIC_APP_URL is set; otherwise fall
  // back to the live origin after mount. `url` is derived from the current
  // inviteCode on every render (not stored in state) so it always reflects the
  // latest code after a regenerate + router.refresh().
  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, [baseUrl]);
  const url = inviteCode
    ? `${origin}/public/events/${eventId}?code=${inviteCode}`
    : "";

  // Guest price (events.invite_price). Empty string = unset.
  const [price, setPrice] = useState(invitePrice === null ? "" : String(invitePrice));
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const savedPrice = invitePrice === null ? "" : String(invitePrice);
  const priceChanged = price.trim() !== savedPrice;
  const priceParsed = price.trim() === "" ? null : Number(price);
  const priceInvalid =
    priceParsed !== null && (!Number.isFinite(priceParsed) || priceParsed < 0);

  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const prereqsMet = registrationEnabled && invitePrice !== null;

  async function savePrice() {
    if (priceInvalid) {
      setPriceError("Guest price must be 0 or a positive amount, or blank to clear.");
      return;
    }
    setPriceError(null);
    setPriceSaved(false);
    setPriceSaving(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/invite-code`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_price: priceParsed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPriceError(data.error || "Could not save guest price. Try again.");
        return;
      }
      setPriceSaved(true);
      router.refresh();
    } catch {
      setPriceError("Network error. Could not save guest price.");
    } finally {
      setPriceSaving(false);
    }
  }

  async function regenerate() {
    const confirmed = window.confirm(
      "Regenerating revokes the current link immediately. Anyone holding it will lose access. Continue?"
    );
    if (!confirmed) return;
    setLinkError(null);
    setStatus(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/invite-code`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLinkError(data.error || "Could not generate link. Try again.");
        return;
      }
      setStatus(
        inviteCode
          ? "New link generated — the old one no longer works."
          : "Invite link generated."
      );
      router.refresh();
    } catch {
      setLinkError("Network error. Could not generate link.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setLinkError("Could not copy. Select the link and copy manually.");
    }
  }

  return (
    <section className="space-y-4 max-w-xl">
      <div>
        <h3 className="font-heading text-lg font-bold text-marine mb-1">
          Private invite link
        </h3>
        <p className="font-body text-sm text-muted-foreground">
          Share this link with a select group to let them register for this
          members-only event without logging in. Members are nudged to log in for
          their member rate; everyone else pays the guest price below.
        </p>
      </div>

      {/* Guest price — always editable so the prerequisite can be satisfied here. */}
      <div>
        <label className="block font-body text-sm font-medium text-marine mb-1">
          Guest price (CHF)
        </label>
        <p className="font-body text-xs text-muted-foreground mb-2">
          Charged to invited guests who are not logged-in members. Enter 0 for a
          free invited registration.
        </p>
        <div className="flex gap-2 items-start">
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPriceSaved(false);
              setPriceError(null);
            }}
            className="w-44 px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
            placeholder="e.g. 50"
          />
          <button
            type="button"
            onClick={savePrice}
            disabled={priceSaving || priceInvalid || !priceChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {priceSaving ? "Saving…" : "Save"}
          </button>
          {priceSaved && !priceChanged && (
            <span className="text-sm font-body text-emerald-700 self-center">
              Saved
            </span>
          )}
        </div>
        {priceError && <p className="text-xs text-red-700 mt-2">{priceError}</p>}
      </div>

      {/* Link area — gated on prerequisites. */}
      <div aria-live="polite">
        {!prereqsMet ? (
          <p className="font-body text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {!registrationEnabled
              ? "Enable registration for this event (in the event editor) to activate the invite link."
              : "Set a guest price above to activate the invite link."}
          </p>
        ) : !inviteCode ? (
          <button
            type="button"
            onClick={regenerate}
            disabled={generating}
            aria-label="Generate invite link"
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {generating ? "Generating…" : "Generate invite link"}
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                aria-label="Invite link"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-cream/40 text-marine font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={copyUrl}
                aria-label="Copy invite link"
                className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors cursor-pointer"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={regenerate}
              disabled={generating}
              aria-label="Regenerate invite link"
              className="mt-2 px-3 py-1.5 bg-white border border-border text-marine rounded-lg text-xs font-body hover:bg-cream transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {generating ? "Regenerating…" : "Regenerate link"}
            </button>
          </>
        )}
        {status && (
          <p className="text-xs font-body text-emerald-700 mt-2">{status}</p>
        )}
        {linkError && <p className="text-xs text-red-700 mt-2">{linkError}</p>}
      </div>
    </section>
  );
}
