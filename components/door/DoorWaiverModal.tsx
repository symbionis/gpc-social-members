"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import WaiverText from "@/components/events/WaiverText";
import type { WaiverLanguage } from "@/lib/events/waiver";

/**
 * The waiver, full screen, at the moment of check-in.
 *
 * It used to sit inline inside the attendee's row, in a box scrolling at max-h-56. That is a
 * legal document being read on a phone, outdoors, by someone the clerk is holding up a queue
 * for — a few visible lines and a cramped scroll is the wrong shape for it. Taking over the
 * screen also removes the surrounding roster, so the clerk cannot tap another guest's control
 * while this one's waiver is open.
 *
 * Rendered through a portal to document.body rather than in place. A `fixed` element is
 * positioned against its nearest transformed/filtered ancestor rather than the viewport, so
 * "full screen" quietly stops being full screen the day any ancestor gains a transform — and
 * the roster already nests inside overflow-hidden containers. The portal makes that
 * impossible instead of merely unlikely; the same reasoning as
 * docs/solutions/design-patterns/slide-over-portal-escape-stacking-context.md.
 */
export default function DoorWaiverModal({
  open,
  guestName,
  language,
  onLanguageChange,
  marketingConsent,
  onMarketingConsentChange,
  onAccept,
  onClose,
  busy = false,
  error = null,
}: {
  open: boolean;
  /** Whose waiver this is — the clerk is looking at a queue, not a single person. */
  guestName: string;
  language: WaiverLanguage;
  onLanguageChange: (lang: WaiverLanguage) => void;
  marketingConsent: boolean;
  onMarketingConsentChange: (next: boolean) => void;
  onAccept: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes, and the page behind must not scroll under the overlay — on a phone that
  // is how a "modal" ends up showing the roster sliding around beneath the waiver.
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
            Terms &amp; waiver
          </h2>
          {guestName && (
            <p className="truncate font-body text-sm text-marine/60">{guestName}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(["en", "fr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLanguageChange(l)}
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
            aria-label="Close waiver"
            className="rounded-lg border-2 border-marine/30 px-3 py-2 font-body text-lg font-semibold leading-none text-marine transition-colors hover:bg-marine/5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* min-h-0 so the scroll happens INSIDE the waiver rather than the flex column growing
          past the viewport and taking the accept button off screen. */}
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
        <WaiverText lang={language} textSize="text-base" maxHeightClass="h-full" />
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700">
            {error}
          </p>
        )}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => onMarketingConsentChange(e.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-marine"
          />
          <span className="font-body text-sm text-marine">
            They&rsquo;d like to receive news and invitations from Geneva Polo Social Club.
          </span>
        </label>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="w-full cursor-pointer rounded-lg bg-marine px-3 py-4 font-body text-base font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : "Accept & check in"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
