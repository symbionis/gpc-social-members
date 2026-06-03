"use client";

import { useState } from "react";
import PhoneInput from "@/components/common/PhoneInput";
import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";
import { formatDateTime } from "@/lib/format";

interface Props {
  eventId: string;
  eventTitle: string;
  eventDate: string;
}

type Phase = "details" | "waiver";
type Result = {
  name: string;
  checkedInAt: string | null;
  already: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STRINGS = {
  en: {
    title: "Check-in",
    chooseLanguage: "Choose your language",
    nameLabel: "Full name",
    emailLabel: "Email",
    phoneLabel: "Phone",
    contactHelp: "Enter the email or phone you registered with.",
    continue: "Continue",
    checking: "Checking…",
    waiverAccept: "I have read and accept the waiver above.",
    commsConsent:
      "I’d like to receive news and invitations from Geneva Polo Social Club. (optional)",
    checkIn: "Check in",
    checkingIn: "Checking in…",
    notFoundTitle: "Not registered",
    notFoundBody: "Please see the welcome desk.",
    networkError: "Something went wrong. Please try again.",
    nameRequired: "Please enter your name.",
    contactRequired: "Please enter a valid email or phone number.",
    waiverRequired: "Please accept the waiver to check in.",
    welcome: "Welcome",
    checkedInAt: "Checked in at",
    alreadyAt: "You were already checked in at",
  },
  fr: {
    title: "Enregistrement",
    chooseLanguage: "Choisissez votre langue",
    nameLabel: "Nom complet",
    emailLabel: "E-mail",
    phoneLabel: "Téléphone",
    contactHelp: "Saisissez l’e-mail ou le téléphone utilisé lors de l’inscription.",
    continue: "Continuer",
    checking: "Vérification…",
    waiverAccept: "J’ai lu et j’accepte la décharge ci-dessus.",
    commsConsent:
      "Je souhaite recevoir les actualités et invitations du Genève Polo Social Club. (facultatif)",
    checkIn: "S’enregistrer",
    checkingIn: "Enregistrement…",
    notFoundTitle: "Non inscrit",
    notFoundBody: "Veuillez vous adresser à l’accueil.",
    networkError: "Une erreur s’est produite. Veuillez réessayer.",
    nameRequired: "Veuillez saisir votre nom.",
    contactRequired: "Veuillez saisir un e-mail ou un téléphone valide.",
    waiverRequired: "Veuillez accepter la décharge pour vous enregistrer.",
    welcome: "Bienvenue",
    checkedInAt: "Enregistré à",
    alreadyAt: "Vous étiez déjà enregistré à",
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
  const [phone, setPhone] = useState<string | null>(null);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [matching, setMatching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notFound, setNotFound] = useState(false);

  // ---- Screen 1: language selector (and nothing else) ----
  if (!lang) {
    return (
      <div className="bg-white rounded-sm border border-border/60 p-6 text-center">
        <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-2">
          Check-in
        </p>
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

  // ---- Not-found state — one uniform screen, no registration path ----
  if (notFound) {
    return (
      <div className="rounded-sm border border-amber-200 bg-amber-50 p-8 text-center">
        <h2 className="font-heading text-xl font-bold text-amber-900 mb-2">
          {t.notFoundTitle}
        </h2>
        <p className="font-body text-sm text-amber-800">{t.notFoundBody}</p>
      </div>
    );
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t.nameRequired);
    const trimmedEmail = email.trim();
    const hasEmail = EMAIL_RE.test(trimmedEmail);
    if (!hasEmail && !phone) return setError(t.contactRequired);

    setMatching(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: hasEmail ? trimmedEmail : undefined,
          phone: phone ?? undefined,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.networkError);
        return;
      }
      if (data.matched) {
        setPhase("waiver");
      } else {
        // Strict gate: not on the roster.
        setNotFound(true);
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
    if (!waiverAccepted) return setError(t.waiverRequired);

    const trimmedEmail = email.trim();
    const hasEmail = EMAIL_RE.test(trimmedEmail);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: hasEmail ? trimmedEmail : undefined,
          phone: phone ?? undefined,
          language: lang,
          waiverAccepted: true,
          marketingConsent,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        // The strict gate re-derived us as not on the roster (e.g. a row changed
        // mid-flow) — show the uniform not-found screen, no routing.
        if (res.status === 404 || data.reason === "not_found") {
          setNotFound(true);
          return;
        }
        setError(data.error || t.networkError);
        return;
      }
      setResult({
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
          <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-1">
            {t.title}
          </p>
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-xs font-body text-muted-foreground mb-1">
              {t.phoneLabel}
            </label>
            <PhoneInput onChange={setPhone} />
          </div>
          <p className="text-xs text-muted-foreground">{t.contactHelp}</p>
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

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-sm font-body text-marine">{t.waiverAccept}</span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-sm font-body text-muted-foreground">
              {t.commsConsent}
            </span>
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
