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

type Phase = "details" | "waiver" | "children";
type Child = { id: string; name: string };
type Result = {
  name: string | null;
  checkedInAt: string | null;
  already: boolean;
  kidsCheckedIn: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Door check-in is designed for on-field, sunny, one-handed use: large type, high
// contrast, big touch targets, minimal text. No name is collected — matching keys on
// email or phone only (KTD10); the confirmation greets the arrival with their roster
// name returned by the server.
const STRINGS = {
  en: {
    title: "Check-in",
    contactPrompt: "Enter your email or your phone number",
    emailLabel: "Email",
    phoneLabel: "Phone",
    or: "or",
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
    contactRequired: "Please enter a valid email or phone number.",
    waiverRequired: "Please accept the waiver to check in.",
    welcome: "Welcome",
    checkedInAt: "Checked in at",
    alreadyAt: "You were already checked in at",
    childrenTitle: "Travelling with children?",
    childrenPrompt: "Tap each child checking in with you.",
    checkInWithKids: "Check in",
    justMe: "Just me",
    kidsCheckedInBody: (n: number) =>
      `${n} ${n === 1 ? "child" : "children"} checked in with you.`,
  },
  fr: {
    title: "Enregistrement",
    contactPrompt: "Saisissez votre e-mail ou votre numéro de téléphone",
    emailLabel: "E-mail",
    phoneLabel: "Téléphone",
    or: "ou",
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
    contactRequired: "Veuillez saisir un e-mail ou un téléphone valide.",
    waiverRequired: "Veuillez accepter la décharge pour vous enregistrer.",
    welcome: "Bienvenue",
    checkedInAt: "Enregistré à",
    alreadyAt: "Vous étiez déjà enregistré à",
    childrenTitle: "Avec des enfants ?",
    childrenPrompt: "Cochez chaque enfant qui entre avec vous.",
    checkInWithKids: "Enregistrer",
    justMe: "Moi seulement",
    kidsCheckedInBody: (n: number) =>
      `${n} enfant${n === 1 ? "" : "s"} enregistré${n === 1 ? "" : "s"} avec vous.`,
  },
} as const;

const inputClass =
  "w-full px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

const primaryButtonClass =
  "w-full px-4 py-5 rounded-xl bg-marine text-white font-body font-semibold text-xl hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export default function EventCheckInForm({
  eventId,
  eventTitle,
  eventDate,
}: Props) {
  const [lang, setLang] = useState<WaiverLanguage | null>(null);
  const [phase, setPhase] = useState<Phase>("details");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [matching, setMatching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Children step: shown after the adult checks in if their party has not-yet-arrived
  // children (no contact → they can't use the kiosk themselves). The adult's check-in
  // is already recorded; this only stamps the kids' arrival.
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedKids, setSelectedKids] = useState<Set<string>>(new Set());
  const [pendingResult, setPendingResult] = useState<Result | null>(null);

  // ---- Screen 1: language selector (and nothing else) ----
  if (!lang) {
    return (
      <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-8 text-center">
        <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-3">
          Check-in
        </p>
        <h1 className="font-heading text-2xl font-bold text-marine mb-1">
          {eventTitle}
        </h1>
        <p className="font-body text-base text-marine/60 mb-8">{eventDate}</p>
        <div className="grid grid-cols-1 gap-4">
          <button
            type="button"
            onClick={() => setLang("fr")}
            className={primaryButtonClass}
          >
            Français
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            className="w-full px-4 py-5 rounded-xl border-2 border-marine/30 bg-white text-marine font-body font-semibold text-xl hover:bg-marine/5 transition-colors cursor-pointer"
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
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-10 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white text-4xl">
          ✓
        </div>
        <h2 className="font-heading text-3xl font-bold text-emerald-900">
          {result.name ? `${t.welcome}, ${result.name}` : t.welcome}
        </h2>
        <p className="font-body text-lg text-emerald-800 mt-3">{eventTitle}</p>
        {time && (
          <p className="font-body text-base text-emerald-700 mt-4">
            {result.already ? t.alreadyAt : t.checkedInAt} {time}
          </p>
        )}
        {result.kidsCheckedIn > 0 && (
          <p className="font-body text-base text-emerald-700 mt-2">
            {t.kidsCheckedInBody(result.kidsCheckedIn)}
          </p>
        )}
      </div>
    );
  }

  // ---- Not-found state — one uniform screen, no registration path ----
  if (notFound) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-10 text-center shadow-sm">
        <h2 className="font-heading text-2xl font-bold text-amber-900 mb-3">
          {t.notFoundTitle}
        </h2>
        <p className="font-body text-lg text-amber-900/80">{t.notFoundBody}</p>
      </div>
    );
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      const adultResult: Result = {
        name: data.name ?? null,
        checkedInAt: data.checkedInAt ?? null,
        already: Boolean(data.already),
        kidsCheckedIn: 0,
      };
      const kids: Child[] = Array.isArray(data.children) ? data.children : [];
      if (kids.length > 0) {
        // Offer to check the party's children in too (default all selected).
        setChildren(kids);
        setSelectedKids(new Set(kids.map((k) => k.id)));
        setPendingResult(adultResult);
        setPhase("children");
      } else {
        setResult(adultResult);
      }
    } catch {
      setError(t.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleKid(id: string) {
    setSelectedKids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmChildren() {
    const base = pendingResult ?? {
      name: null,
      checkedInAt: null,
      already: false,
      kidsCheckedIn: 0,
    };
    const ids = [...selectedKids];
    if (ids.length === 0) {
      setResult({ ...base, kidsCheckedIn: 0 });
      return;
    }
    setSubmitting(true);
    let kidsCheckedIn = 0;
    try {
      const res = await fetch(`/api/events/${eventId}/check-in/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeIds: ids }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) kidsCheckedIn = data.checkedIn ?? 0;
    } catch {
      /* the adult is already checked in — show their result regardless */
    } finally {
      setSubmitting(false);
      setResult({ ...base, kidsCheckedIn });
    }
  }

  const waiver = getWaiver(lang);

  return (
    <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-6 sm:p-8">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-1">
            {t.title}
          </p>
          <h1 className="font-heading text-2xl font-bold text-marine leading-tight">
            {eventTitle}
          </h1>
          <p className="font-body text-base text-marine/60">{eventDate}</p>
        </div>
        <div className="flex shrink-0 gap-1 font-body">
          {(["fr", "en"] as WaiverLanguage[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                lang === l
                  ? "bg-marine text-white"
                  : "text-marine/60 hover:text-marine"
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {phase === "details" && (
        <form onSubmit={handleContinue} className="space-y-5">
          <p className="font-heading text-xl font-bold text-marine">
            {t.contactPrompt}
          </p>
          <div>
            <label className="block text-sm font-body font-medium text-marine/70 mb-1.5">
              {t.emailLabel}
            </label>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="email"
            />
          </div>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="font-body text-sm uppercase tracking-wider text-marine/40">
              {t.or}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div>
            <label className="block text-sm font-body font-medium text-marine/70 mb-1.5">
              {t.phoneLabel}
            </label>
            <PhoneInput onChange={setPhone} large />
          </div>

          {error && (
            <p className="text-base font-body text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}
          <button type="submit" disabled={matching} className={primaryButtonClass}>
            {matching ? t.checking : t.continue}
          </button>
        </form>
      )}

      {phase === "waiver" && (
        <form onSubmit={handleCheckIn} className="space-y-5">
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-cream/40 p-4 text-sm font-body text-marine">
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

          <label className="flex items-start gap-4 cursor-pointer rounded-xl border-2 border-marine/20 p-4 has-[:checked]:border-marine has-[:checked]:bg-marine/5 transition-colors">
            <input
              type="checkbox"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-base font-body font-medium text-marine">
              {t.waiverAccept}
            </span>
          </label>

          <label className="flex items-start gap-4 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-sm font-body text-marine/70">
              {t.commsConsent}
            </span>
          </label>

          {error && (
            <p className="text-base font-body text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className={primaryButtonClass}>
            {submitting ? t.checkingIn : t.checkIn}
          </button>
        </form>
      )}

      {phase === "children" && (
        <div className="space-y-5">
          <div>
            <p className="font-heading text-xl font-bold text-marine">
              {t.childrenTitle}
            </p>
            <p className="font-body text-base text-marine/60 mt-1">
              {t.childrenPrompt}
            </p>
          </div>

          <div className="space-y-3">
            {children.map((kid) => {
              const checked = selectedKids.has(kid.id);
              return (
                <label
                  key={kid.id}
                  className="flex items-center gap-4 cursor-pointer rounded-xl border-2 border-marine/20 p-4 has-[:checked]:border-marine has-[:checked]:bg-marine/5 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleKid(kid.id)}
                    className="h-6 w-6 shrink-0 accent-marine cursor-pointer"
                  />
                  <span className="text-lg font-body font-medium text-marine">
                    {kid.name || "—"}
                  </span>
                </label>
              );
            })}
          </div>

          <button
            type="button"
            onClick={confirmChildren}
            disabled={submitting}
            className={primaryButtonClass}
          >
            {submitting ? t.checkingIn : t.checkInWithKids}
          </button>
          <button
            type="button"
            onClick={() => setResult(pendingResult)}
            disabled={submitting}
            className="w-full px-4 py-3 rounded-xl border-2 border-marine/20 bg-white text-marine/70 font-body font-semibold text-lg hover:bg-marine/5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {t.justMe}
          </button>
        </div>
      )}
    </div>
  );
}
