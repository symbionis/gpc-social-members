"use client";

import { useEffect, useState } from "react";
import { getWaiver, type WaiverLanguage } from "@/lib/events/waiver";
import { formatDateTime } from "@/lib/format";

interface Props {
  eventId: string;
  eventTitle: string;
  eventDate: string;
}

type Kind = "registered" | "member" | "guest";
type Phase = "details" | "inviter" | "waiver" | "blocked";
type Inviter = { registrationId: string; label: string };
type Result = {
  kind: Kind;
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
    continue: "Continue",
    checking: "Checking…",
    inviterLabel: "Who invited you?",
    notRecognized:
      "It looks like you're not on the registration list or a member yet. Who invited you?",
    inviterHelp:
      "Start typing their name and pick them from the list. If they're not listed, just type the name.",
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
    title: "Enregistrement",
    chooseLanguage: "Choisissez votre langue",
    nameLabel: "Nom complet",
    emailLabel: "E-mail",
    continue: "Continuer",
    checking: "Vérification…",
    inviterLabel: "Qui vous a invité ?",
    notRecognized:
      "Il semble que vous ne soyez ni sur la liste d'inscription ni membre. Qui vous a invité ?",
    inviterHelp:
      "Commencez à taper leur nom et sélectionnez-le dans la liste. S'il n'apparaît pas, saisissez simplement le nom.",
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
  const [inviterQuery, setInviterQuery] = useState("");
  const [inviterSuggestions, setInviterSuggestions] = useState<Inviter[]>([]);
  const [selectedInviter, setSelectedInviter] = useState<Inviter | null>(null);
  const [needsInviter, setNeedsInviter] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [matching, setMatching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Debounced typeahead over this event's registrations for the inviter picker.
  useEffect(() => {
    if (selectedInviter && selectedInviter.label === inviterQuery) return;
    const q = inviterQuery.trim();
    if (q.length < 4) {
      setInviterSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/events/${eventId}/check-in/inviters?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setInviterSuggestions(data.inviters ?? []);
        }
      } catch {
        /* aborted or offline — leave suggestions as-is */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [inviterQuery, eventId, selectedInviter]);

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
        signal: AbortSignal.timeout(10000),
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
        setPhase("inviter");
      }
    } catch {
      setError(t.networkError);
    } finally {
      setMatching(false);
    }
  }

  function pickInviter(inviter: Inviter) {
    setSelectedInviter(inviter);
    setInviterQuery(inviter.label);
    setInviterSuggestions([]);
  }

  function handleInviterContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const inviterValue = (selectedInviter?.label ?? inviterQuery).trim();
    if (!inviterValue) return setError(t.inviterRequired);
    setPhase("waiver");
  }

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const inviterValue = (selectedInviter?.label ?? inviterQuery).trim();
    if (needsInviter && !inviterValue) {
      setPhase("inviter");
      return setError(t.inviterRequired);
    }
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
          inviterName: needsInviter ? inviterValue : undefined,
          invitedByRegistrationId: needsInviter
            ? selectedInviter?.registrationId
            : undefined,
          waiverAccepted: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!res.ok) {
        // Strict flipped between match and submit -> show the blocked state.
        if (res.status === 403) {
          setPhase("blocked");
          return;
        }
        // The server re-derived us as an unmatched guest (e.g. a registration
        // was removed mid-flow) and needs an inviter the form hasn't shown yet.
        if (res.status === 400 && !needsInviter) {
          setNeedsInviter(true);
          setPhase("inviter");
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

      {phase === "inviter" && (
        <form onSubmit={handleInviterContinue} className="space-y-4">
          <p className="font-body text-sm text-marine bg-cream/40 border border-border rounded-lg px-4 py-3">
            {t.notRecognized}
          </p>
          <div>
            <label className="block text-xs font-body text-muted-foreground mb-1">
              {t.inviterLabel}
            </label>
            <input
              type="text"
              value={inviterQuery}
              onChange={(e) => {
                setInviterQuery(e.target.value);
                setSelectedInviter(null);
              }}
              className={inputClass}
              autoComplete="off"
              autoFocus
            />
            {inviterSuggestions.length > 0 && !selectedInviter && (
              <ul className="mt-1 rounded-lg border border-border bg-white overflow-hidden">
                {inviterSuggestions.map((s) => (
                  <li key={s.registrationId}>
                    <button
                      type="button"
                      onClick={() => pickInviter(s)}
                      className="w-full text-left px-3 py-2 text-sm font-body text-marine hover:bg-cream/60 cursor-pointer"
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t.inviterHelp}</p>
          </div>
          {error && (
            <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full px-4 py-3 bg-marine text-white rounded-lg text-base font-body font-semibold hover:bg-marine-light transition-colors cursor-pointer"
          >
            {t.continue}
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
