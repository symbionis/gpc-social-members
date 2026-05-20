"use client";

import { useState } from "react";
import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";
import { formatDateTime } from "@/lib/format";

interface Props {
  eventId: string;
  eventTitle: string;
  eventDate: string;
}

type Kind = "registered" | "member" | "guest";
type Phase = "details" | "waiver" | "blocked";
type Result = {
  kind: Kind;
  name: string;
  checkedInAt: string | null;
  already: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STRINGS = {
  en: {
    chooseLanguage: "Choose your language",
    nameLabel: "Full name",
    emailLabel: "Email",
    continue: "Continue",
    checking: "Checking…",
    inviterLabel: "Who invited you?",
    inviterHelp: "The name of the member or person who invited you.",
    waiverAccept: "I have read and accept the waiver above.",
    checkIn: "Check in",
    checkingIn: "Checking in…",
    blockedTitle: "Please see the welcome desk",
    blockedBody:
      "We couldn't find your registration. Our team at the desk will help you check in.",
    networkError: "Something went wrong. Please try again.",
    nameRequired: "Please enter your name.",
    emailRequired: "Please enter a valid email.",
    inviterRequired: "Please tell us who invited you.",
    waiverRequired: "Please accept the waiver to check in.",
    welcome: "Welcome",
    checkedInAt: "Checked in at",
    alreadyAt: "You were already checked in at",
    badge: { registered: "Registered", member: "Member", guest: "Guest" },
  },
  fr: {
    chooseLanguage: "Choisissez votre langue",
    nameLabel: "Nom complet",
    emailLabel: "E-mail",
    continue: "Continuer",
    checking: "Vérification…",
    inviterLabel: "Qui vous a invité ?",
    inviterHelp: "Le nom du membre ou de la personne qui vous a invité.",
    waiverAccept: "J’ai lu et j’accepte la décharge ci-dessus.",
    checkIn: "S’enregistrer",
    checkingIn: "Enregistrement…",
    blockedTitle: "Veuillez vous adresser à l’accueil",
    blockedBody:
      "Nous n’avons pas trouvé votre inscription. Notre équipe à l’accueil vous aidera à vous enregistrer.",
    networkError: "Une erreur s’est produite. Veuillez réessayer.",
    nameRequired: "Veuillez saisir votre nom.",
    emailRequired: "Veuillez saisir un e-mail valide.",
    inviterRequired: "Veuillez indiquer qui vous a invité.",
    waiverRequired: "Veuillez accepter la décharge pour vous enregistrer.",
    welcome: "Bienvenue",
    checkedInAt: "Enregistré à",
    alreadyAt: "Vous étiez déjà enregistré à",
    badge: { registered: "Inscrit", member: "Membre", guest: "Invité" },
  },
} as const;

const inputClass =
  "w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-base focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function EventCheckInForm({
  eventId,
  eventTitle,
  eventDate,
}: Props) {
  const [lang, setLang] = useState<WaiverLanguage | null>(null);
  const [phase, setPhase] = useState<Phase>("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviterName, setInviterName] = useState("");
  const [needsInviter, setNeedsInviter] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [matching, setMatching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // ---- Screen 1: language selector (and nothing else) ----
  if (!lang) {
    return (
      <div className="bg-white rounded-sm border border-border/60 p-6 text-center">
        <h1 className="font-heading text-xl font-bold text-marine mb-1">
          {eventTitle}
        </h1>
        <p className="font-body text-sm text-muted-foreground mb-6">{eventDate}</p>
        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => setLang("fr")}
            className="w-full px-4 py-4 rounded-lg bg-marine text-white font-body font-semibold text-base hover:bg-marine-light transition-colors cursor-pointer"
          >
            Français
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className="w-full px-4 py-4 rounded-lg border border-marine/30 bg-white text-marine font-body font-semibold text-base hover:bg-marine/5 transition-colors cursor-pointer"
          >
            English
          </button>
        </div>
      </div>
    );
  }

  const t = STRINGS[lang];

  // ---- Confirmation (green) — shown to the clerk ----
  if (result) {
    const time = result.checkedInAt ? formatDateTime(result.checkedInAt) : null;
    return (
      <div className="rounded-sm border-2 border-emerald-300 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white text-3xl">
          ✓
        </div>
        <p className="font-body text-sm uppercase tracking-wide text-emerald-700">
          {t.badge[result.kind]}
        </p>
        <h2 className="font-heading text-2xl font-bold text-emerald-900 mt-1">
          {t.welcome}, {result.name}
        </h2>
        <p className="font-body text-base text-emerald-800 mt-2">{eventTitle}</p>
        {time && (
          <p className="font-body text-sm text-emerald-700 mt-3">
            {result.already ? t.alreadyAt : t.checkedInAt} {time}
          </p>
        )}
      </div>
    );
  }

  // ---- Strict-mode blocked state ----
  if (phase === "blocked") {
    return (
      <div className="rounded-sm border border-amber-200 bg-amber-50 p-8 text-center">
        <h2 className="font-heading text-xl font-bold text-amber-900 mb-2">
          {t.blockedTitle}
        </h2>
        <p className="font-body text-sm text-amber-800">{t.blockedBody}</p>
      </div>
    );
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t.nameRequired);
    if (!EMAIL_RE.test(email.trim())) return setError(t.emailRequired);

    setMatching(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.networkError);
        return;
      }
      if (data.matched) {
        setNeedsInviter(false);
        setPhase("waiver");
      } else if (data.strict) {
        setPhase("blocked");
      } else {
        setNeedsInviter(true);
        setPhase("waiver");
      }
    } catch {
      setError(t.networkError);
    } finally {
      setMatching(false);
    }
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsInviter && !inviterName.trim()) return setError(t.inviterRequired);
    if (!waiverAccepted) return setError(t.waiverRequired);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          language: lang,
          inviterName: needsInviter ? inviterName.trim() : undefined,
          waiverAccepted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Strict flipped between match and submit -> show the blocked state.
        if (res.status === 403) {
          setPhase("blocked");
          return;
        }
        setError(data.error || t.networkError);
        return;
      }
      setResult({
        kind: data.kind,
        name: data.name,
        checkedInAt: data.checkedInAt ?? null,
        already: Boolean(data.already),
      });
    } catch {
      setError(t.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  const waiver = getWaiver(lang);

  return (
    <div className="bg-white rounded-sm border border-border/60 p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="font-heading text-xl font-bold text-marine">
            {eventTitle}
          </h1>
          <p className="font-body text-sm text-muted-foreground">{eventDate}</p>
        </div>
        <div className="flex shrink-0 gap-1 text-xs font-body">
          {(["fr", "en"] as WaiverLanguage[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                lang === l
                  ? "bg-marine text-white"
                  : "text-muted-foreground hover:text-marine"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {phase === "details" && (
        <form onSubmit={handleContinue} className="space-y-4">
          <div>
            <label className="block text-xs font-body text-muted-foreground mb-1">
              {t.nameLabel}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
            />
          </div>
          <div>
            <label className="block text-xs font-body text-muted-foreground mb-1">
              {t.emailLabel}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
            />
          </div>
          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={matching}
            className="w-full px-4 py-3 bg-marine text-white rounded-lg text-base font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {matching ? t.checking : t.continue}
          </button>
        </form>
      )}

      {phase === "waiver" && (
        <form onSubmit={handleCheckIn} className="space-y-4">
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-cream/40 p-4 text-sm font-body text-marine">
            <h2 className="font-heading text-base font-bold text-marine">
              {waiver.title}
            </h2>
            <p className="text-xs text-muted-foreground mb-2">{waiver.subtitle}</p>
            <p className="mb-3">{waiver.intro}</p>
            <ol className="space-y-3 list-decimal pl-4">
              {waiver.clauses.map((clause, i) => (
                <li key={i}>
                  <span className="font-semibold">{clause.heading}</span>
                  {clause.paragraphs.map((p, j) => (
                    <p key={j} className="mt-1">
                      {p}
                    </p>
                  ))}
                  {clause.bullets && (
                    <ul className="list-disc pl-5 mt-1">
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

          {needsInviter && (
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                {t.inviterLabel}
              </label>
              <input
                type="text"
                value={inviterName}
                onChange={(e) => setInviterName(e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground mt-1">{t.inviterHelp}</p>
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-sm font-body text-marine">{t.waiverAccept}</span>
          </label>

          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-3 bg-marine text-white rounded-lg text-base font-body font-semibold hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? t.checkingIn : t.checkIn}
          </button>
        </form>
      )}
    </div>
  );
}
