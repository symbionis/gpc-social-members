"use client";

import { useState } from "react";
import { isFullName, joinName } from "@/lib/names";
import PhoneInput from "@/components/common/PhoneInput";
import { type WaiverLanguage } from "@/lib/events/waiver";
import WaiverText from "@/components/events/WaiverText";

interface Props {
  token: string;
  eventTitle: string;
  eventDate: string;
  /** The lead/purchaser's name, for "you're joining X's party" context. */
  leadName: string;
  /** Slots left at page load (display only; the server re-checks on submit). */
  remaining: number;
  /**
   * Ticket types this party purchased (e.g. asado meal options). A selector is
   * shown only when there's a real choice (>1); a single-type party is auto-assigned
   * server-side, so no UI is needed.
   */
  ticketTypes: { id: string; title: string }[];
  /** Open children's-ticket slots — drives the "add children by name" control. */
  childRemaining: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Guest self-registration (U9). A focused, phone-friendly form mirroring the door
// check-in: name + email or phone, with an OPTIONAL waiver (the guest may sign here
// or at the door — R11). On success the guest is on the roster and matchable at the
// door by the contact they entered.
const STRINGS = {
  en: {
    eyebrow: "Guest pre-registration",
    spotsRemaining: (n: number) =>
      `${n} ${n === 1 ? "spot" : "spots"} remaining for this party`,
    joining: (lead: string) => `You’re joining ${lead}’s party.`,
    qrPolicy:
      "You’ll need your own QR code to get in — no QR code, no bracelet. Add your email and we’ll send it straight to you.",
    namePrompt: "Add yourself to the guest list",
    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    emailLabel: "Email",
    phoneLabel: "Phone",
    or: "or",
    contactHelp: "Enter your email or phone so we can find you at the door.",
    ticketLabel: "Ticket",
    ticketPlaceholder: "Choose your ticket…",
    ticketRequired: "Please choose your ticket.",
    ticketTaken: "That ticket was just taken. Refreshing the available tickets…",
    childrenHeading: "Children with you",
    childrenHelp: (n: number) =>
      `Add the children coming with you by name (${n} ${n === 1 ? "place" : "places"}). They check in with you at the door.`,
    childNamePlaceholder: "Child's name",
    addChild: "+ Add a child",
    doneKidsBody: (n: number) =>
      `${n} ${n === 1 ? "child" : "children"} added to your party.`,
    waiverHeading: "Waiver (optional now)",
    waiverHelp: "You can accept it now, or sign at the door when you arrive.",
    waiverAccept: "I have read and accept the waiver above.",
    commsConsent:
      "I’d like to receive news and invitations from Geneva Polo Social Club. (optional)",
    submit: "Add me to the list",
    submitting: "Adding…",
    fullTitle: "This party is full",
    fullBody:
      "All spots for this party have been taken. If you think this is a mistake, please contact the person who invited you.",
    invalidBody: "Something went wrong. Please try again.",
    nameRequired: "Please enter your first and last name.",
    contactRequired: "Please enter a valid email or phone number.",
    doneTitle: "You’re on the list",
    doneSignedBody: "See you there! You’re all set.",
    doneUnsignedBody: "See you there! You’ll sign the waiver at the door.",
  },
  fr: {
    eyebrow: "Pré-inscription invité",
    spotsRemaining: (n: number) =>
      `${n} ${n === 1 ? "place" : "places"} restante${n === 1 ? "" : "s"} pour ce groupe`,
    joining: (lead: string) => `Vous rejoignez le groupe de ${lead}.`,
    qrPolicy:
      "Vous aurez besoin de votre propre code QR pour entrer — pas de code QR, pas de bracelet. Ajoutez votre e-mail et nous vous l’enverrons directement.",
    namePrompt: "Ajoutez-vous à la liste des invités",
    firstNameLabel: "Prénom",
    lastNameLabel: "Nom de famille",
    emailLabel: "E-mail",
    phoneLabel: "Téléphone",
    or: "ou",
    contactHelp:
      "Saisissez votre e-mail ou téléphone pour qu’on vous retrouve à l’entrée.",
    ticketLabel: "Billet",
    ticketPlaceholder: "Choisissez votre billet…",
    ticketRequired: "Veuillez choisir votre billet.",
    ticketTaken: "Ce billet vient d’être pris. Actualisation des billets disponibles…",
    childrenHeading: "Enfants avec vous",
    childrenHelp: (n: number) =>
      `Ajoutez les enfants qui vous accompagnent par leur nom (${n} place${n === 1 ? "" : "s"}). Ils s’enregistrent avec vous à l’entrée.`,
    childNamePlaceholder: "Nom de l’enfant",
    addChild: "+ Ajouter un enfant",
    doneKidsBody: (n: number) =>
      `${n} enfant${n === 1 ? "" : "s"} ajouté${n === 1 ? "" : "s"} à votre groupe.`,
    waiverHeading: "Décharge (facultatif maintenant)",
    waiverHelp:
      "Vous pouvez l’accepter maintenant ou la signer à l’entrée à votre arrivée.",
    waiverAccept: "J’ai lu et j’accepte la décharge ci-dessus.",
    commsConsent:
      "Je souhaite recevoir les actualités et invitations du Genève Polo Social Club. (facultatif)",
    submit: "M’ajouter à la liste",
    submitting: "Ajout…",
    fullTitle: "Ce groupe est complet",
    fullBody:
      "Toutes les places de ce groupe ont été prises. Si vous pensez qu’il s’agit d’une erreur, contactez la personne qui vous a invité.",
    invalidBody: "Une erreur s’est produite. Veuillez réessayer.",
    nameRequired: "Veuillez saisir votre prénom et votre nom de famille.",
    contactRequired: "Veuillez saisir un e-mail ou un téléphone valide.",
    doneTitle: "Vous êtes inscrit",
    doneSignedBody: "À bientôt ! Tout est en ordre.",
    doneUnsignedBody: "À bientôt ! Vous signerez la décharge à l’entrée.",
  },
} as const;

const inputClass =
  "w-full px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";
const primaryButtonClass =
  "w-full px-4 py-5 rounded-xl bg-marine text-white font-body font-semibold text-xl hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export default function SelfRegistrationForm({
  token,
  eventTitle,
  eventDate,
  leadName,
  remaining,
  ticketTypes,
  childRemaining,
}: Props) {
  const [lang, setLang] = useState<WaiverLanguage>("fr");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // The roster files guests by surname, so both halves are required (lib/names).
  const name = joinName(firstName, lastName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  // Only a real choice (>1 available type) needs a selector; a single remaining type
  // is sent implicitly, and none-left falls through with no ticket (rare edge).
  const showTicketChoice = ticketTypes.length > 1;
  const [ticketTypeId, setTicketTypeId] = useState("");
  // Name-only children attending with this adult (capped at the open child slots).
  const [childNames, setChildNames] = useState<string[]>([]);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ signed: boolean; kidsAdded: number } | null>(null);
  const [full, setFull] = useState(remaining <= 0);

  const canAddChild = childRemaining > 0 && childNames.length < childRemaining;
  function setChildName(i: number, v: string) {
    setChildNames((prev) => prev.map((n, idx) => (idx === i ? v : n)));
  }
  function removeChild(i: number) {
    setChildNames((prev) => prev.filter((_, idx) => idx !== i));
  }

  const t = STRINGS[lang];

  const header = (
    <div className="flex items-start justify-between gap-3 mb-6">
      <div>
        <p className="font-accent text-sm tracking-[0.3em] uppercase text-sky-dark mb-1">
          {t.eyebrow}
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
              lang === l ? "bg-marine text-white" : "text-marine/60 hover:text-marine"
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );

  if (done) {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-10 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white text-4xl">
          ✓
        </div>
        <h2 className="font-heading text-3xl font-bold text-emerald-900">
          {t.doneTitle}{name.trim() ? `, ${name.trim()}` : ""}
        </h2>
        <p className="font-body text-lg text-emerald-800 mt-3">{eventTitle}</p>
        <p className="font-body text-base text-emerald-700 mt-4">
          {done.signed ? t.doneSignedBody : t.doneUnsignedBody}
        </p>
        {done.kidsAdded > 0 && (
          <p className="font-body text-base text-emerald-700 mt-2">
            {t.doneKidsBody(done.kidsAdded)}
          </p>
        )}
      </div>
    );
  }

  if (full) {
    return (
      <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-6 sm:p-8">
        {header}
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-8 text-center">
          <h2 className="font-heading text-xl font-bold text-amber-900 mb-2">
            {t.fullTitle}
          </h2>
          <p className="font-body text-base text-amber-900/80">{t.fullBody}</p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isFullName(name)) return setError(t.nameRequired);
    const trimmedEmail = email.trim();
    const hasEmail = EMAIL_RE.test(trimmedEmail);
    if (!hasEmail && !phone) return setError(t.contactRequired);
    if (showTicketChoice && !ticketTypeId) return setError(t.ticketRequired);

    // A single available type is implicit (no selector); >1 uses the picked one.
    const effectiveTicketTypeId = showTicketChoice
      ? ticketTypeId
      : ticketTypes[0]?.id ?? "";

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/registrations/${token}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: hasEmail ? trimmedEmail : undefined,
          phone: phone ?? undefined,
          language: lang,
          waiverAccepted,
          marketingConsent,
          ticketTypeId: effectiveTicketTypeId || undefined,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        if (data.reason === "full") {
          setFull(true);
          return;
        }
        if (data.reason === "type_full") {
          // Lost a race for the last of this type — reload so the ticket list
          // reflects what's actually still available.
          setError(t.ticketTaken);
          setTimeout(() => window.location.reload(), 1500);
          return;
        }
        setError(data.error || t.invalidBody);
        return;
      }

      // The adult is registered. Add any named children to the party — best-effort:
      // a children failure never undoes the adult's successful registration.
      let kidsAdded = 0;
      const names = childNames.map((n) => n.trim()).filter(Boolean);
      if (names.length > 0) {
        try {
          const cres = await fetch(`/api/public/registrations/${token}/children`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ names }),
            signal: AbortSignal.timeout(10000),
          });
          const cdata = await cres.json().catch(() => ({}));
          if (cres.ok && cdata.ok) kidsAdded = cdata.added ?? 0;
        } catch {
          /* leave kidsAdded at 0 — the adult is still registered */
        }
      }
      setDone({ signed: Boolean(data.waiverSigned), kidsAdded });
    } catch {
      setError(t.invalidBody);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-border/60 shadow-sm p-6 sm:p-8">
      {header}

      <div className="mb-5 rounded-xl bg-cream/60 px-4 py-3">
        <p className="font-body text-sm font-semibold text-marine">
          {t.spotsRemaining(remaining)}
        </p>
        {leadName && (
          <p className="font-body text-sm text-marine/70 mt-0.5">
            {t.joining(leadName)}
          </p>
        )}
        <p className="font-body text-sm text-marine/80 mt-2">{t.qrPolicy}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="font-heading text-xl font-bold text-marine">{t.namePrompt}</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-body font-medium text-marine/70 mb-1.5">
              {t.firstNameLabel}
            </label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
              autoComplete="given-name"
            />
          </div>
          <div>
            <label className="block text-sm font-body font-medium text-marine/70 mb-1.5">
              {t.lastNameLabel}
            </label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
              autoComplete="family-name"
            />
          </div>
        </div>

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
          <p className="mt-2 text-xs font-body text-marine/50">{t.contactHelp}</p>
        </div>

        {showTicketChoice && (
          <div>
            <label className="block text-sm font-body font-medium text-marine/70 mb-1.5">
              {t.ticketLabel}
            </label>
            <select
              required
              value={ticketTypeId}
              onChange={(e) => setTicketTypeId(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="" disabled>
                {t.ticketPlaceholder}
              </option>
              {ticketTypes.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {childRemaining > 0 && (
          <div className="rounded-xl border border-border bg-cream/40 p-4">
            <h2 className="font-heading text-base font-bold text-marine">
              {t.childrenHeading}
            </h2>
            <p className="font-body text-xs text-marine/60 mb-3">
              {t.childrenHelp(childRemaining)}
            </p>
            {childNames.length > 0 && (
              <div className="space-y-2 mb-2">
                {childNames.map((cn, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={cn}
                      onChange={(e) => setChildName(i, e.target.value)}
                      placeholder={t.childNamePlaceholder}
                      className={inputClass}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => removeChild(i)}
                      aria-label="Remove child"
                      className="shrink-0 h-12 w-12 rounded-xl border-2 border-marine/20 text-marine/60 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {canAddChild && (
              <button
                type="button"
                onClick={() => setChildNames((prev) => [...prev, ""])}
                className="text-sm font-body font-semibold text-marine hover:underline cursor-pointer"
              >
                {t.addChild}
              </button>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-cream/40 p-4">
          <h2 className="font-heading text-base font-bold text-marine">
            {t.waiverHeading}
          </h2>
          <p className="font-body text-xs text-marine/60 mb-3">{t.waiverHelp}</p>
          <WaiverText lang={lang} />

          <label className="mt-3 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-marine cursor-pointer"
            />
            <span className="text-sm font-body font-medium text-marine">
              {t.waiverAccept}
            </span>
          </label>

          {waiverAccepted && (
            <label className="mt-3 flex items-start gap-3 cursor-pointer">
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
          )}
        </div>

        {error && (
          <p className="text-base font-body text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? t.submitting : t.submit}
        </button>
      </form>
    </div>
  );
}
