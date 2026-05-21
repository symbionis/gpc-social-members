// Liability waiver content (FR/EN), extracted verbatim from the source PDFs:
//   docs/WAVER GPC privat EVENT fr.pdf
//   docs/WAVER GPC privat EVENT en.pdf
//
// See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md (U3).
//
// EVENT-SPECIFIC: this waiver is written for the Open Doors event. Its clauses
// name "the Open Doors event", so serving it for any other event would make
// attendees sign a document about the wrong event. `WAIVER_EVENT_ID` +
// `hasWaiverForEvent()` are the single gate: the public check-in page refuses
// (404) for any other event until the flow is parameterized per event. The
// subtitle's DATE is no longer hardcoded — it is derived from the event's
// start_date at render time (see formatWaiverDate in lib/format.ts) so the
// legal text can never drift from the DB the way "May 22" once did.

// The one event this waiver is valid for. When check-in goes multi-event,
// replace this constant + hasWaiverForEvent with a per-event waiver lookup.
export const WAIVER_EVENT_ID = "d83759b3-36d1-4a78-8060-542d55c25cf3";

export function hasWaiverForEvent(eventId: string): boolean {
  return eventId === WAIVER_EVENT_ID;
}
//
// WAIVER_VERSION is DERIVED from a hash of the content below, not hand-maintained,
// so editing any clause necessarily changes the version recorded against each
// acceptance — the audit can never silently point a stale version at changed text.
// The hash is a small pure-JS FNV-1a so this module is isomorphic (the client
// component renders the text; the server records the version), with no node:crypto.

export type WaiverLanguage = "fr" | "en";

export type WaiverClause = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  closing?: string;
};

export type Waiver = {
  title: string;
  subtitle: string;
  intro: string;
  clauses: WaiverClause[];
};

const WAIVERS: Record<WaiverLanguage, Waiver> = {
  en: {
    title: "Liability Waiver – One-Day Visit",
    // Event name only — the date is appended at render from start_date.
    subtitle: "Open Doors Event",
    intro: "By signing this document, I acknowledge and agree to the following:",
    clauses: [
      {
        heading: "Risks inherent to a polo event",
        paragraphs: [
          "My presence as a spectator or participant at the Genève Polo Social Members Club Open Doors event implies awareness and acceptance of the risks inherent to this environment.",
          "These risks include, but are not limited to:",
        ],
        bullets: [
          "the unpredictable behavior of horses,",
          "kicking, sudden movements or collisions,",
          "high-speed movement of balls and mallets,",
          "as well as changing ground and environmental conditions.",
        ],
        closing:
          "These risks apply to all visitors, including those in spectator areas, field-side, and adjacent spaces.",
      },
      {
        heading: "Full acceptance of risks",
        paragraphs: [
          "I acknowledge that I have been informed of these risks and accept them fully and knowingly.",
          "I confirm that my presence on the club premises is entirely at my own risk.",
        ],
      },
      {
        heading: "Temporary member status",
        paragraphs: [
          "For the duration of my visit, I agree to be considered a temporary member of the Genève Polo Social Members Club.",
          "As such, I agree to comply with all:",
        ],
        bullets: [
          "general terms and conditions,",
          "internal regulations,",
          "club policies and safety instructions,",
        ],
        closing: "as in force at the time of the event.",
      },
      {
        heading: "Media and image rights",
        paragraphs: [
          "I acknowledge that all image, photo, video and media rights related to this event belong to the Genève Polo Social Members Club. The club is authorized to use such content freely, on any medium and without time limitation, for communication purposes, without compensation.",
        ],
      },
      {
        heading: "Release of liability",
        paragraphs: [
          "I hereby release and discharge the Genève Polo Social Members Club, as well as any affiliated entities (including EARL SCCF and Genève Polo Club de Haute-Savoie), its members, employees, officers and representatives, from any liability for injury, damage or loss — whether bodily or material — that may occur in connection with my presence at the club.",
          "This waiver does not apply in cases of gross negligence or intentional misconduct.",
        ],
      },
      {
        heading: "Consent to emergency medical care",
        paragraphs: [
          "In case of medical emergency, I consent to receive appropriate medical treatment and accept responsibility for any associated costs.",
        ],
      },
      {
        heading: "Conduct and safety",
        paragraphs: [
          "I agree to behave responsibly, follow staff instructions, and refrain from entering restricted or unauthorized areas.",
        ],
      },
    ],
  },
  fr: {
    title: "Décharge de responsabilité – Visite ponctuelle",
    // Nom de l'événement uniquement — la date est ajoutée au rendu depuis start_date.
    subtitle: "Portes Ouvertes",
    intro: "En signant la présente, je reconnais et accepte ce qui suit :",
    clauses: [
      {
        heading: "Risques inhérents à un événement de polo",
        paragraphs: [
          "Ma présence en qualité de spectateur ou participant aux Portes Ouvertes du Genève Polo Social Club implique la connaissance et l’acceptation des risques inhérents à cet environnement.",
          "Ces risques incluent notamment, sans s’y limiter :",
        ],
        bullets: [
          "le comportement imprévisible des chevaux,",
          "les coups de queue, ruades, déplacements rapides ou renversements,",
          "les mouvements de balles et de maillets à grande vitesse,",
          "ainsi que les conditions changeantes du terrain et des installations.",
        ],
        closing:
          "Ces risques s’appliquent à tous les visiteurs, y compris dans les zones spectateurs, en bord de terrain et dans les espaces adjacents.",
      },
      {
        heading: "Acceptation pleine et entière des risques",
        paragraphs: [
          "Je reconnais avoir été informé(e) de ces risques et les accepte pleinement et en toute connaissance de cause.",
          "Je confirme que ma présence sur les installations du club se fait sous ma seule responsabilité.",
        ],
      },
      {
        heading: "Statut de membre temporaire",
        paragraphs: [
          "Pour la durée de ma visite, j’accepte d’être considéré(e) comme membre temporaire du Genève Polo Social Members Club.",
          "À ce titre, je reconnais avoir pris connaissance et m’engage à respecter l’ensemble des :",
        ],
        bullets: [
          "conditions générales,",
          "règlements intérieurs,",
          "chartes et consignes de sécurité du club,",
        ],
        closing: "tels qu’ils sont en vigueur.",
      },
      {
        heading: "Droits à l’image et médias",
        paragraphs: [
          "Je reconnais que les droits relatifs à l’image, à la photographie, à la vidéo et à tout autre support médiatique réalisés lors de cet événement appartiennent au Genève Polo Social Members Club. Le club est autorisé à utiliser ces contenus librement, sur tout support et sans limitation de durée, à des fins de communication, sans contrepartie financière.",
        ],
      },
      {
        heading: "Décharge de responsabilité",
        paragraphs: [
          "Je libère et décharge le Genève Polo Social Members Club, ainsi que toute entité affiliée (incluant notamment EARL SCCF et Genève Polo Club de Haute-Savoie), ses membres, employés, dirigeants et représentants, de toute responsabilité civile pour tout préjudice, blessure ou dommage — corporel ou matériel — pouvant survenir dans le cadre de ma présence au club.",
          "Cette décharge s’applique sauf en cas de faute lourde ou intentionnelle.",
        ],
      },
      {
        heading: "Consentement aux soins médicaux d’urgence",
        paragraphs: [
          "En cas d’urgence médicale, je consens à recevoir les soins jugés nécessaires par les services compétents et accepte d’en assumer les éventuels coûts.",
        ],
      },
      {
        heading: "Comportement et sécurité",
        paragraphs: [
          "Je m’engage à adopter un comportement responsable, à respecter les consignes du personnel et à ne pas pénétrer dans des zones interdites ou non autorisées.",
        ],
      },
    ],
  },
};

/** FNV-1a 32-bit, hex. Pure JS so the module stays isomorphic (no node:crypto). */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Version is a function of the content, so any text edit changes it. Languages
 * are serialized in a fixed order so the version depends only on the content,
 * not on object key insertion order.
 */
export function computeWaiverVersion(
  waivers: Record<WaiverLanguage, Waiver>
): string {
  const orderedLangs: WaiverLanguage[] = ["en", "fr"];
  const canonical = orderedLangs.map((l) => JSON.stringify(waivers[l])).join("|");
  return `open-doors-2026-${fnv1aHex(canonical)}`;
}

export const WAIVER_VERSION = computeWaiverVersion(WAIVERS);

export function getWaiver(lang: WaiverLanguage): Waiver {
  return WAIVERS[lang] ?? WAIVERS.en;
}
