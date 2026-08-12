// The one order every roster surface reads in.
//
// The printed door sheet, the door console and the admin attendee list all answer the same
// question — "is this person on the list?" — and staff move between them mid-shift, often
// with someone waiting. They must therefore agree on where a name sits, so this comparator
// lives on its own rather than inside any one of them.
//
// Pure and dependency-free on purpose: two of the three consumers are client components, and
// importing this from the roster builder would drag its server-side query code into their
// bundles.

// Heuristic split of a single "Full name" string for non-members: the last
// whitespace-separated token is the last name, everything before it the first
// name(s). One token → all first name. Members use their authoritative split.
export function splitFullName(name: string | null): { first: string; last: string } {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

// Surname sort, case- and accent-aware (Ärnström, Öberg file where a Swiss reader
// expects them). A row with no surname to sort on goes last, rather than silently
// landing at the top of the sheet under an empty string.
//
// Within the surname-less tail, a genuinely *named* row (a one-word name like
// "Madonna": last === "", named === true) must outrank the blank unnamed lines, so it
// never sinks below the "To fill in" divider and gets read as an unfilled slot. Named
// one-word names therefore sort ahead of the true blanks; the blanks then order by
// booking ref, clustering a booking's fill-in lines together at the very end.
export function bySurname(
  a: { last: string; first: string; bookingRef: string; named?: boolean },
  b: { last: string; first: string; bookingRef: string; named?: boolean }
): number {
  if (!a.last !== !b.last) return a.last ? -1 : 1;
  if (!a.last && !b.last && a.named !== b.named) return a.named ? -1 : 1;
  const last = a.last.localeCompare(b.last, undefined, { sensitivity: "base" });
  if (last !== 0) return last;
  const first = a.first.localeCompare(b.first, undefined, { sensitivity: "base" });
  if (first !== 0) return first;
  return a.bookingRef.localeCompare(b.bookingRef);
}

/**
 * Sort key for a roster row that carries a display name. Wraps splitFullName so a caller
 * with only a "Full name" string can sort without repeating the split at every call site.
 * `named` distinguishes a real one-word name from an unfilled slot — see bySurname.
 */
export function surnameKey(
  name: string | null,
  bookingRef: string | null,
  named: boolean
): { last: string; first: string; bookingRef: string; named: boolean } {
  const { first, last } = splitFullName(name);
  return { first, last, bookingRef: bookingRef ?? "", named };
}
