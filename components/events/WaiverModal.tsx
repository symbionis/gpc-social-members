"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import WaiverText from "@/components/events/WaiverText";
import type { WaiverLanguage } from "@/lib/events/waiver";

/**
 * The waiver, full screen, at the moment of check-in. THE single presentation — both door
 * paths render this one component.
 *
 * There were two before: the QR scan phase and the roster row's own block. They agreed on the
 * waiver body (both render WaiverText, so both stamp the same WAIVER_VERSION) but had already
 * diverged on everything around it — one translated its chrome and required an explicit
 * affirmation, the other did neither. Since the recorded version is a hash of the waiver DATA,
 * it cannot tell you what the guest saw or how they consented, so that difference was
 * invisible in the record: the answer depended on which surface admitted them and nothing said
 * which. One component is the only way that stays true.
 *
 * The phone is handed to the GUEST here, so the chrome is bilingual, the type is large, and
 * the targets are thumb-sized.
 *
 * Rendered through a portal to document.body. A `fixed` element is positioned against its
 * nearest transformed/filtered ancestor rather than the viewport, so "full screen" quietly
 * stops being full screen the day any ancestor gains a transform — and the roster already
 * nests inside overflow-hidden containers. Same reasoning as
 * docs/solutions/design-patterns/slide-over-portal-escape-stacking-context.md.
 */

const COPY: Record<
  WaiverLanguage,
  { title: string; intro: string; accept: string; comms: string; button: string; close: string }
> = {
  en: {
    title: "Terms & waiver",
    intro: "Please read and accept the waiver to check in.",
    accept: "I have read and accept the waiver above.",
    comms: "I'd like to receive news and invitations from Geneva Polo Social Club.",
    button: "Accept & check in",
    close: "Close",
  },
  fr: {
    title: "Conditions et décharge",
    intro: "Merci de lire et d'accepter la décharge pour l'enregistrement.",
    accept: "J'ai lu et j'accepte la décharge ci-dessus.",
    comms: "Je souhaite recevoir les actualités et invitations du Geneva Polo Social Club.",
    button: "Accepter et enregistrer",
    close: "Fermer",
  },
};

export interface WaiverAcceptance {
  language: WaiverLanguage;
  marketingConsent: boolean;
}

export default function WaiverModal({
  open,
  guestName,
  onAccept,
  onClose,
  defaultLanguage = "en",
  busy = false,
  error = null,
}: {
  open: boolean;
  /** Whose waiver this is — the clerk is working a queue, not a single person. */
  guestName: string;
  onAccept: (acceptance: WaiverAcceptance) => void;
  onClose: () => void;
  defaultLanguage?: WaiverLanguage;
  busy?: boolean;
  error?: string | null;
}) {
  const [language, setLanguage] = useState<WaiverLanguage>(defaultLanguage);
  const [accepted, setAccepted] = useState(false);
  // Pre-ticked by deliberate decision (2026-08-11): the club takes consent as given unless the
  // guest objects. Not an oversight — do not "fix" it to opt-in without asking.
  const [marketingConsent, setMarketingConsent] = useState(true);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Reset every time it opens. Without this the affirmation carries: the clerk checks in one
  // guest, opens the next, and the box is still ticked — admitting someone on a stranger's
  // acceptance. The one piece of state in here that must never persist across guests.
  useEffect(() => {
    if (!open) return;
    setLanguage(defaultLanguage);
    setAccepted(false);
    setMarketingConsent(true);
  }, [open, defaultLanguage]);

  // Escape closes, and the page behind must not scroll under the overlay — on a phone that is
  // how a "modal" ends up showing the roster sliding around beneath the waiver.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const t = COPY[language];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="door-waiver-heading"
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2
            id="door-waiver-heading"
            className="font-heading text-lg font-bold leading-tight text-marine"
          >
            {t.title}
          </h2>
          {guestName && <p className="truncate font-body text-sm text-marine/60">{guestName}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(["en", "fr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={language === l}
              className={`rounded-lg border-2 px-3 py-2 font-body text-sm font-semibold transition-colors cursor-pointer ${
                language === l
                  ? "border-marine bg-marine text-white"
                  : "border-marine/30 text-marine/60"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="rounded-lg border-2 border-marine/30 px-3 py-2 font-body text-lg font-semibold leading-none text-marine transition-colors hover:bg-marine/5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* min-h-0 so the scroll happens INSIDE the waiver rather than the flex column growing
          past the viewport and taking the accept button off screen. */}
      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-3">
        <WaiverText lang={language} textSize="text-base" maxHeightClass="h-full" />
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        <p className="font-body text-sm text-marine/70">{t.intro}</p>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700">
            {error}
          </p>
        )}
        {/* The affirmation is its own act, separate from the button. A tap on a phone being
            passed between people is easy to make by accident; ticking this is not. */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-marine"
          />
          <span className="font-body text-sm font-medium text-marine">{t.accept}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-marine"
          />
          <span className="font-body text-sm text-marine/70">{t.comms}</span>
        </label>
        <button
          type="button"
          onClick={() => onAccept({ language, marketingConsent })}
          disabled={busy || !accepted}
          className="w-full cursor-pointer rounded-lg bg-marine px-3 py-4 font-body text-base font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : t.button}
        </button>
      </div>
    </div>,
    document.body,
  );
}
