// Attendance terms and liability waiver content (FR/EN), extracted verbatim from
// the source PDF:
//   GenevaPoloClub_Waiver_EN_FR_DE_public (Bettina, 05.08.2026)
//
// The source is trilingual (EN/FR/DE); only EN and FR are carried here, as those
// are the two languages the check-in and self-registration flows offer.
//
// See docs/plans/2026-05-20-001-feat-event-door-checkin-plan.md (U3) and
// docs/waiver-gpc-event.md for the full rendered text.
//
// GENERIC attendance terms: the same text is shown wherever a guest accepts — the door
// console, the QR scan, and the guest's own ticket page, all through the one WaiverModal.
// It names no specific event on purpose: each surface already shows which event the visit
// is for, and each acceptance is stamped onto the guest's own ticket row (waiver_version,
// waiver_accepted_at, language, marketing_consent — see lib/events/checkin.ts). Keep the
// clauses event-neutral so this stays valid for any event.
//
// WAIVER_VERSION is DERIVED from a hash of the content below, not hand-maintained,
// so editing any clause necessarily changes the version recorded against each
// acceptance — the audit can never silently point a stale version at changed text.
//
// Read that guarantee narrowly: it covers the TEXT and nothing else. The hash sees the
// clauses, not the chrome around them, not which language the instructions were in, and
// not what gesture counted as consent. Two surfaces once rendered this same text with
// different chrome and different acceptance gestures, and every row they wrote carried an
// identical version. That is why there is exactly one presentation component —
// components/events/WaiverModal.tsx — and why a second one is a defect rather than a
// convenience. See docs/solutions/architecture-patterns/a-content-hash-attests-to-the-text-not-the-presentation.md.
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
  intro: string;
  clauses: WaiverClause[];
};

/**
 * Where a signer sends an image-use objection or a data-protection request.
 * Named once so the two clause-6 mentions cannot drift apart.
 */
const CLUB_CONTACT = "info@genevapolo.com";

const WAIVERS: Record<WaiverLanguage, Waiver> = {
  en: {
    title:
      "General Terms of Attendance & Liability Acknowledgment (applies to all events organized by the Club)",
    intro:
      "By confirming and accepting these terms when purchasing a ticket or registering for an event, I acknowledge, understand and agree to the following for the duration of my presence at any event organized by the Genève Polo Social Members Club:",
    clauses: [
      {
        heading: "Risks inherent to polo events",
        paragraphs: [
          "My presence as a spectator, guest, participant or player at any event organized by the Genève Polo Social Members Club implies awareness and acceptance of the risks inherent to this environment. These risks include, but are not limited to:",
        ],
        bullets: [
          "the unpredictable behavior of horses, including kicking, biting, bolting, sudden movements or collisions;",
          "the high-speed movement of balls, mallets, riders and horses;",
          "changing ground, weather and environmental conditions;",
          "the presence of vehicles, machinery or equipment used for event operations;",
          "the consumption of food, drink or alcoholic beverages served on site.",
        ],
        closing:
          "These risks apply to all persons present, including those in spectator areas, field-side, stable areas, and any adjacent spaces accessible during the event.",
      },
      {
        heading: "Full and informed acceptance of risk",
        paragraphs: [
          "I acknowledge that I have been informed of these risks and accept them fully, knowingly and voluntarily. I confirm that my presence on the premises, and my participation in any activity connected with the event, is entirely at my own risk. I confirm that I am not aware of any medical condition that would make my presence unsafe, and that I attend voluntarily.",
        ],
      },
      {
        heading: "Temporary member status",
        paragraphs: [
          "For the duration of my presence, I agree to be considered a temporary member of the Genève Polo Social Members Club. As such, I agree to comply with all general terms and conditions, internal regulations, club policies and safety instructions, and instructions from staff, marshals or organizers, as in force at the time of the event.",
        ],
      },
      {
        heading: "Personal property",
        paragraphs: [
          "I acknowledge that the Club, its affiliated entities, employees and representatives are not responsible for the loss, theft or damage of any personal belongings, vehicles, or animals I bring onto the premises.",
        ],
      },
      {
        heading: "Consent to emergency medical care",
        paragraphs: [
          "In case of a medical emergency, I consent to receive appropriate first aid and medical treatment, including transport to a medical facility if necessary, and I accept responsibility for any costs not covered by my personal health or accident insurance. I confirm that maintaining adequate personal health and accident insurance is my own responsibility.",
        ],
      },
      {
        heading: "Media, image rights and data protection",
        paragraphs: [
          `I acknowledge that general photographs and video recordings may be taken during the event for archival and communication purposes (including social media and the Club's website), on the basis of the Club's legitimate interest in documenting and promoting its events. I understand that I may object to the use of images in which I am individually and clearly identifiable by contacting the Club at ${CLUB_CONTACT}; general crowd or atmosphere images are not covered by this objection right to the extent I am not the principal subject of the image. Any use of an individually featured photograph or video of me for dedicated promotional or marketing purposes (e.g. as the main subject of a dedicated post or advertisement) requires my separate, specific and freely given consent, which is not a condition for attending the event and will be requested independently of these terms.`,
          `Personal data collected (name, contact details) is processed by the Genève Polo Social Members Club for event administration, safety and communication purposes, in accordance with the Swiss Federal Act on Data Protection (nFADP) and, where applicable, the EU General Data Protection Regulation (GDPR). For questions regarding your data, please contact ${CLUB_CONTACT}.`,
        ],
      },
      {
        heading: "Release and limitation of liability",
        paragraphs: [
          'To the fullest extent permitted by applicable law, I release and discharge the Genève Polo Social Members Club, its affiliated entities (including EARL SCCF and Genève Polo Club de Haute-Savoie), members, employees, officers, volunteers and representatives (together, the "Released Parties") from any liability, claim or demand of any kind, whether in contract or tort, arising out of or in connection with any injury, illness, damage or loss — whether bodily, material or otherwise — that may occur in connection with my presence at, or participation in, any Club event.',
          "This release does not apply to damage caused by gross negligence or intentional misconduct of the Released Parties, and does not limit any right that may not lawfully be waived under the mandatory consumer protection or sports-event legislation of the country in which the relevant event takes place. Where such mandatory law restricts or invalidates any part of this release, the remaining provisions shall continue to apply, and this document shall in any event serve as evidence of my informed and voluntary acceptance of the inherent risks described above.",
        ],
      },
      {
        heading: "Conduct and safety",
        paragraphs: [
          "I agree to behave responsibly, to follow the instructions of staff, marshals and organizers at all times, to keep a safe distance from horses and playing areas unless authorized, and to refrain from entering restricted, staff-only, or unauthorized areas.",
        ],
      },
      {
        heading: "Minors",
        paragraphs: [
          "If I am attending with, or am the parent or legal guardian of, a person under 18 years of age, I confirm that I have read these terms in full, that I have explained their content and the risks described herein to the minor in an age-appropriate manner, and that I accept these terms on the minor's behalf.",
        ],
      },
      {
        heading: "Governing law, jurisdiction and severability",
        paragraphs: [
          "These terms are governed by Swiss law, without prejudice to any mandatory provisions of the law of the country in which the relevant event takes place, which shall apply to the extent required by such law. Any dispute shall be submitted to the competent courts at the Club's registered seat, subject to mandatory jurisdiction rules applicable to consumers. If any provision is held invalid or unenforceable, the remaining provisions shall remain in full force and effect, and the invalid provision shall be replaced by a valid provision that most closely reflects its original intent.",
        ],
      },
      {
        heading: "Acknowledgment",
        paragraphs: [
          "By ticking the corresponding box when purchasing my ticket or registering, I confirm that I have read these terms in their entirety, that I understand their content, and that I accept them voluntarily and without duress.",
        ],
      },
    ],
  },
  fr: {
    title:
      "Conditions générales de participation et reconnaissance de responsabilité (applicable à tous les événements organisés par le Club)",
    intro:
      "En confirmant et en acceptant les présentes conditions lors de l’achat d’un billet ou de l’inscription à un événement, je reconnais, comprends et accepte ce qui suit pour la durée de ma présence à tout événement organisé par le Genève Polo Social Members Club :",
    clauses: [
      {
        heading: "Risques inhérents aux événements de polo",
        paragraphs: [
          "Ma présence en tant que spectateur, invité, participant ou joueur à tout événement organisé par le Genève Polo Social Members Club implique la connaissance et l’acceptation des risques inhérents à cet environnement. Ces risques comprennent, sans s’y limiter :",
        ],
        bullets: [
          "le comportement imprévisible des chevaux, notamment les coups de pied, morsures, embardées, mouvements brusques ou collisions ;",
          "le déplacement à grande vitesse des balles, maillets, cavaliers et chevaux ;",
          "les conditions changeantes du terrain, de la météo et de l’environnement ;",
          "la présence de véhicules, de machines ou d’équipements utilisés pour l’organisation de l’événement ;",
          "la consommation de nourriture, de boissons ou de boissons alcoolisées servies sur place.",
        ],
        closing:
          "Ces risques s’appliquent à toute personne présente, y compris dans les zones réservées aux spectateurs, en bordure de terrain, dans les zones d’écurie et dans tout espace adjacent accessible pendant l’événement.",
      },
      {
        heading: "Acceptation pleine et informée des risques",
        paragraphs: [
          "Je reconnais avoir été informé(e) de ces risques et les accepter pleinement, sciemment et volontairement. Je confirme que ma présence sur les lieux, ainsi que ma participation à toute activité liée à l’événement, se fait entièrement à mes propres risques. Je confirme n’avoir connaissance d’aucune condition médicale qui rendrait ma présence dangereuse, et assister à l’événement de mon propre gré.",
        ],
      },
      {
        heading: "Statut de membre temporaire",
        paragraphs: [
          "Pour la durée de ma présence, j’accepte d’être considéré(e) comme membre temporaire du Genève Polo Social Members Club. À ce titre, je m’engage à respecter l’ensemble des conditions générales, règlements intérieurs, politiques du club et consignes de sécurité, ainsi que les instructions du personnel, des commissaires et des organisateurs, en vigueur au moment de l’événement.",
        ],
      },
      {
        heading: "Biens personnels",
        paragraphs: [
          "Je reconnais que le Club, ses entités affiliées, employés et représentants ne sont pas responsables de la perte, du vol ou de la détérioration de tout bien personnel, véhicule ou animal que j’apporte sur les lieux.",
        ],
      },
      {
        heading: "Consentement aux soins médicaux d’urgence",
        paragraphs: [
          "En cas d’urgence médicale, je consens à recevoir les premiers secours et soins médicaux appropriés, y compris un transport vers un établissement médical si nécessaire, et j’accepte la responsabilité de tout coût non couvert par mon assurance maladie ou accident personnelle. Je confirme qu’il m’appartient de disposer d’une couverture d’assurance maladie et accident personnelle adéquate.",
        ],
      },
      {
        heading: "Droits à l’image et protection des données",
        paragraphs: [
          `Je reconnais que des photographies et enregistrements vidéo à caractère général peuvent être réalisés pendant l’événement à des fins d’archivage et de communication (y compris sur les réseaux sociaux et le site internet du Club), sur la base de l’intérêt légitime du Club à documenter et promouvoir ses événements. Je comprends que je peux m’opposer à l’utilisation d’images sur lesquelles je serais individuellement et clairement identifiable, en contactant le Club à ${CLUB_CONTACT} ; les images de foule ou d’ambiance générale ne sont pas concernées par ce droit d’opposition dans la mesure où je n’en suis pas le sujet principal. Toute utilisation d’une photographie ou vidéo me mettant individuellement en avant à des fins promotionnelles ou publicitaires dédiées (par exemple comme sujet principal d’une publication ou d’une publicité) nécessite mon consentement préalable, spécifique et donné librement, lequel n’est pas une condition de ma participation à l’événement et sera recueilli séparément des présentes conditions.`,
          `Les données personnelles collectées (nom, coordonnées) sont traitées par le Genève Polo Social Members Club à des fins de gestion de l’événement, de sécurité et de communication, conformément à la loi fédérale suisse sur la protection des données (nLPD) et, le cas échéant, au règlement général européen sur la protection des données (RGPD). Pour toute question relative à vos données, veuillez contacter ${CLUB_CONTACT}.`,
        ],
      },
      {
        heading: "Décharge et limitation de responsabilité",
        paragraphs: [
          "Dans toute la mesure permise par le droit applicable, je libère et décharge le Genève Polo Social Members Club, ses entités affiliées (y compris EARL SCCF et Genève Polo Club de Haute-Savoie), ses membres, employés, dirigeants, bénévoles et représentants (ensemble, les « Parties Libérées ») de toute responsabilité, réclamation ou demande de quelque nature que ce soit, contractuelle ou délictuelle, résultant de ou liée à toute blessure, maladie, dommage ou perte — corporelle, matérielle ou autre — susceptible de survenir en lien avec ma présence à, ou ma participation à, tout événement du Club.",
          "Cette décharge ne s’applique pas aux dommages causés par une faute grave ou un comportement intentionnel des Parties Libérées, et ne limite aucun droit auquel il ne peut être valablement renoncé en vertu des dispositions impératives de protection des consommateurs ou de la réglementation applicable aux manifestations sportives du pays dans lequel l’événement concerné se déroule. Lorsque de telles dispositions impératives restreignent ou invalident une partie de la présente décharge, les autres dispositions demeurent applicables, et le présent document vaut en tout état de cause preuve de mon acceptation informée et volontaire des risques inhérents décrits ci-dessus.",
        ],
      },
      {
        heading: "Conduite et sécurité",
        paragraphs: [
          "Je m’engage à me comporter de manière responsable, à suivre en permanence les instructions du personnel, des commissaires et des organisateurs, à maintenir une distance de sécurité par rapport aux chevaux et aux aires de jeu sauf autorisation contraire, et à ne pas pénétrer dans les zones réservées, réservées au personnel ou non autorisées.",
        ],
      },
      {
        heading: "Mineurs",
        paragraphs: [
          "Si j’accompagne, ou si je suis le parent ou le représentant légal, d’une personne âgée de moins de 18 ans, je confirme avoir lu intégralement les présentes conditions, avoir expliqué leur contenu et les risques qui y sont décrits au mineur d’une manière adaptée à son âge, et j’accepte les présentes conditions au nom du mineur.",
        ],
      },
      {
        heading: "Droit applicable, juridiction et divisibilité",
        paragraphs: [
          "Les présentes conditions sont régies par le droit suisse, sans préjudice des dispositions impératives du droit du pays dans lequel l’événement concerné se déroule, lesquelles s’appliquent dans la mesure requise par ce droit. Tout litige sera soumis aux tribunaux compétents du siège du Club, sous réserve des règles de compétence impératives applicables aux consommateurs. Si une disposition des présentes est jugée invalide ou inapplicable, les autres dispositions demeurent pleinement en vigueur, et la disposition invalide sera remplacée par une disposition valide reflétant au plus près son intention initiale.",
        ],
      },
      {
        heading: "Confirmation",
        paragraphs: [
          "En cochant la case correspondante lors de l’achat de mon billet ou de mon inscription, je confirme avoir lu ces conditions dans leur intégralité, en avoir compris le contenu, et les accepter volontairement et sans contrainte.",
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
 *
 * The prefix labels the document these clauses come from. It changed from
 * `open-doors-2026-` when the Open Doors waiver was replaced by the Club's
 * general attendance terms (05.08.2026), so a stored version string still says
 * which document was accepted, not just that the text differed.
 */
export function computeWaiverVersion(
  waivers: Record<WaiverLanguage, Waiver>
): string {
  const orderedLangs: WaiverLanguage[] = ["en", "fr"];
  const canonical = orderedLangs.map((l) => JSON.stringify(waivers[l])).join("|");
  return `gpc-terms-2026-${fnv1aHex(canonical)}`;
}

export const WAIVER_VERSION = computeWaiverVersion(WAIVERS);

export function getWaiver(lang: WaiverLanguage): Waiver {
  return WAIVERS[lang] ?? WAIVERS.en;
}
