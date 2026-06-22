"use client";

import { useState } from "react";
import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";

// Shared waiver + communications-consent modal for the mobile interaction pages
// (forwarded-tickets page now; door / self-registration can adopt it next). The guest
// reads the liability waiver, accepts it, and optionally opts into club news. The
// caller records acceptance (the waiver version is always sourced server-side).

const STRINGS = {
  en: {
    heading: "Terms & waiver",
    intro: "Please read and accept the waiver to validate your ticket.",
    accept: "I have read and accept the waiver above.",
    comms: "I’d like to receive news and invitations from Geneva Polo Social Club. (optional)",
    confirm: "Accept terms",
    close: "Close",
  },
  fr: {
    heading: "Conditions et décharge",
    intro: "Veuillez lire et accepter la décharge pour valider votre billet.",
    accept: "J’ai lu et j’accepte la décharge ci-dessus.",
    comms:
      "Je souhaite recevoir les actualités et invitations du Genève Polo Social Club. (facultatif)",
    confirm: "Accepter les conditions",
    close: "Fermer",
  },
} as const;

export interface WaiverAcceptance {
  language: WaiverLanguage;
  marketingConsent: boolean;
}

export default function WaiverConsentModal({
  open,
  onClose,
  onAccept,
  defaultLanguage = "fr",
  defaultConsent = true,
}: {
  open: boolean;
  onClose: () => void;
  onAccept: (acceptance: WaiverAcceptance) => void;
  defaultLanguage?: WaiverLanguage;
  defaultConsent?: boolean;
}) {
  const [lang, setLang] = useState<WaiverLanguage>(defaultLanguage);
  const [accepted, setAccepted] = useState(false);
  const [consent, setConsent] = useState(defaultConsent);

  if (!open) return null;

  const t = STRINGS[lang];
  const waiver = getWaiver(lang);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-marine/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-marine">{t.heading}</h2>
          <div className="flex shrink-0 gap-1 font-body">
            {(["fr", "en"] as WaiverLanguage[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  lang === l ? "bg-marine text-white" : "text-marine/60 hover:text-marine"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 font-body text-base text-marine/80">{t.intro}</p>
          <div className="rounded-xl border border-border bg-cream/40 p-4 text-base font-body text-marine">
            <h3 className="font-heading text-base font-bold text-marine">{waiver.title}</h3>
            <p className="mb-3 mt-1">{waiver.intro}</p>
            <ol className="list-decimal space-y-3 pl-4">
              {waiver.clauses.map((clause, i) => (
                <li key={i}>
                  <span className="font-semibold">{clause.heading}</span>
                  {clause.paragraphs.map((p, j) => (
                    <p key={j} className="mt-1">
                      {p}
                    </p>
                  ))}
                  {clause.bullets && (
                    <ul className="mt-1 list-disc pl-5">
                      {clause.bullets.map((b, k) => (
                        <li key={k}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {clause.closing && <p className="mt-1">{clause.closing}</p>}
                </li>
              ))}
            </ol>
          </div>

          <label className="mt-4 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-marine"
            />
            <span className="font-body text-base font-medium text-marine">{t.accept}</span>
          </label>

          {accepted && (
            <label className="mt-3 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-6 w-6 shrink-0 accent-marine"
              />
              <span className="font-body text-base text-marine/70">{t.comms}</span>
            </label>
          )}
        </div>

        <div className="flex gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={() => onAccept({ language: lang, marketingConsent: consent })}
            disabled={!accepted}
            className="flex-1 rounded-xl bg-marine px-4 py-3.5 text-base font-body font-semibold text-white disabled:opacity-50"
          >
            {t.confirm}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border/70 px-4 py-3.5 text-base font-body text-marine"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
