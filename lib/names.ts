// A person's name, as the club needs it: a first name AND a last name.
//
// The booking and self-registration forms used to capture one free-text "Full name"
// box that only had to be non-empty, so a one-word entry ("Hallf") sailed through. The
// door roster files people by surname, so a person with no surname has nothing to be
// filed under and is effectively unfindable on the printed sheet.
//
// The forms now capture first and last separately; these helpers are the single rule
// shared by the forms and by the API routes behind them, so the client and the server
// can never disagree about what counts as a full name.
//
// Deliberately NOT applied to the door console, where staff type what a person says
// under time pressure and must not be blocked. (Formerly also exempted a children's
// ticket type, named name-only by an adult — that exemption was retired: naming is
// now mandatory and identical for every ticket type.)

/** Collapse whitespace so " Ann   Marie  Lead " → "Ann Marie Lead". */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** "Louisa" + "Mercier" → "Louisa Mercier". Either side may carry internal spaces. */
export function joinName(first: string, last: string): string {
  return normalizeName(`${normalizeName(first)} ${normalizeName(last)}`);
}

/**
 * True when `name` carries both a first and a last name — i.e. at least two
 * whitespace-separated parts. "Hallf" is false; "Louisa Mercier" and
 * "Mohd Fahmi bin Mohd Ariff" are true.
 */
export function isFullName(name: string): boolean {
  return normalizeName(name).split(" ").filter(Boolean).length >= 2;
}

/**
 * Best-effort split of an existing single-string name, for pre-filling the two fields
 * from data captured before they existed (a signed-in member's stored name). The last
 * whitespace-separated part is the last name. Only used to seed the inputs — the person
 * can correct it, and what they submit is what gets stored.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = normalizeName(full).split(" ").filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}
