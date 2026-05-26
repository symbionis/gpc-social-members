"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export interface InviteTicketType {
  id: string;
  title: string;
  price_member: number | null;
  price_non_member: number | null;
  invite_price: number | null;
  counts_as_seat: boolean;
}

interface Props {
  eventId: string;
  /** Absolute base URL (NEXT_PUBLIC_APP_URL); may be empty in local dev. */
  baseUrl: string;
  /** Current secret code (events.invite_code); null = none generated yet. */
  inviteCode: string | null;
  /** Whether registration is enabled (set in the event editor). */
  registrationEnabled: boolean;
  /** Active ticket types — each carries its own guest (invite) price. */
  ticketTypes: InviteTicketType[];
}

export default function EventInviteLink({
  eventId,
  baseUrl,
  inviteCode,
  registrationEnabled,
  ticketTypes,
}: Props) {
  const router = useRouter();

  const [origin, setOrigin] = useState(baseUrl);
  useEffect(() => {
    if (!baseUrl && typeof window !== "undefined") setOrigin(window.location.origin);
  }, [baseUrl]);
  const url = inviteCode ? `${origin}/public/events/${eventId}?code=${inviteCode}` : "";

  // Per-type guest price inputs (strings; "" = unset). Keyed by ticket type id.
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ticketTypes.map((t) => [t.id, t.invite_price === null ? "" : String(t.invite_price)])
    )
  );
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const savedPrices = Object.fromEntries(
    ticketTypes.map((t) => [t.id, t.invite_price === null ? "" : String(t.invite_price)])
  );
  const priceChanged = ticketTypes.some((t) => (prices[t.id] ?? "").trim() !== savedPrices[t.id]);
  const anyInvalid = ticketTypes.some((t) => {
    const raw = (prices[t.id] ?? "").trim();
    if (raw === "") return false;
    const n = Number(raw);
    return !Number.isFinite(n) || n < 0;
  });

  // The link activates only when registration is enabled AND every active type
  // has a guest price saved — otherwise an invited guest would hit an unpriced
  // (misconfigured) type. This reads the persisted prop values, not the inputs.
  const allPriced = ticketTypes.length > 0 && ticketTypes.every((t) => t.invite_price !== null);
  const prereqsMet = registrationEnabled && allPriced;

  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function savePrices() {
    if (anyInvalid) {
      setPriceError("Guest prices must be 0 or a positive amount, or blank to clear.");
      return;
    }
    setPriceError(null);
    setPriceSaved(false);
    setPriceSaving(true);
    try {
      // Write each type through the single-writer ticket-types route, sending the
      // full current body so only the guest price changes.
      for (const t of ticketTypes) {
        const raw = (prices[t.id] ?? "").trim();
        const res = await fetch(`/api/admin/events/${eventId}/ticket-types/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: t.title,
            price_member: t.price_member,
            price_non_member: t.price_non_member,
            counts_as_seat: t.counts_as_seat,
            invite_price: raw === "" ? null : Number(raw),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setPriceError(data.error || `Could not save the guest price for "${t.title}".`);
          return;
        }
      }
      setPriceSaved(true);
      router.refresh();
    } catch {
      setPriceError("Network error. Could not save guest prices.");
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
      const res = await fetch(`/api/admin/events/${eventId}/invite-code`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLinkError(data.error || "Could not generate link. Try again.");
        return;
      }
      setStatus(inviteCode ? "New link generated — the old one no longer works." : "Invite link generated.");
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
        <h3 className="font-heading text-lg font-bold text-marine mb-1">Private invite link</h3>
        <p className="font-body text-sm text-muted-foreground">
          Share this link with a select group to let them register for this members-only event
          without logging in. Members are nudged to log in for their member rate; everyone else pays
          the guest price set per ticket type below.
        </p>
      </div>

      {/* Per-type guest prices — always editable so the prerequisite can be satisfied here. */}
      <div>
        <label className="block font-body text-sm font-medium text-marine mb-1">Guest prices (CHF)</label>
        <p className="font-body text-xs text-muted-foreground mb-2">
          Charged to invited guests who are not logged-in members. Enter 0 for a free invited
          registration. The link activates once every ticket type has a guest price.
        </p>
        <div className="space-y-2">
          {ticketTypes.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <span className="flex-1 font-body text-sm text-marine truncate">{t.title}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={prices[t.id] ?? ""}
                onChange={(e) => {
                  setPrices((prev) => ({ ...prev, [t.id]: e.target.value }));
                  setPriceSaved(false);
                  setPriceError(null);
                }}
                className="w-36 px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
                placeholder="e.g. 50"
                aria-label={`Guest price for ${t.title}`}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-center mt-2">
          <button
            type="button"
            onClick={savePrices}
            disabled={priceSaving || anyInvalid || !priceChanged}
            className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {priceSaving ? "Saving…" : "Save guest prices"}
          </button>
          {priceSaved && !priceChanged && (
            <span className="text-sm font-body text-emerald-700">Saved</span>
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
              : "Set a guest price for every ticket type above to activate the invite link."}
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
        {status && <p className="text-xs font-body text-emerald-700 mt-2">{status}</p>}
        {linkError && <p className="text-xs text-red-700 mt-2">{linkError}</p>}
      </div>
    </section>
  );
}
