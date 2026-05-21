// Deterministic Geneva-time formatters. Used by every admin component that
// renders a date or amount. Why hand-rolled instead of direct toLocale*:
// Safari and Node ICU disagree on the whitespace character inserted between
// time parts in `en-GB` (U+202F vs U+0020), which triggers React #418
// hydration mismatches. We extract only numeric parts via formatToParts and
// assemble the final string ourselves so server and client produce identical
// bytes.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAYS_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
const MONTHS_LONG_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;
const WEEKDAYS_LONG_FR = [
  "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
] as const;

const GENEVA_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "long",
  hour12: false,
});

type Parts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  weekday: string;
};

function genevaParts(d: Date): Parts {
  const out = {} as Record<string, string>;
  for (const p of GENEVA_FMT.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out as Parts;
}

function toDate(input: string | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = typeof input === "string" ? new Date(input) : input;
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = genevaParts(d);
  const day = parseInt(p.day, 10);
  const month = MONTHS[parseInt(p.month, 10) - 1];
  return `${day} ${month} ${p.year}`;
}

export function formatDateTime(
  input: string | Date | null | undefined,
  opts: { seconds?: boolean } = {},
): string {
  const d = toDate(input);
  if (!d) return "—";
  const p = genevaParts(d);
  const day = parseInt(p.day, 10);
  const month = MONTHS[parseInt(p.month, 10) - 1];
  const time = opts.seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${day} ${month} ${p.year}, ${time}`;
}

export function formatCurrency(amount: number, opts: { decimals?: number } = {}): string {
  const dec = opts.decimals ?? 0;
  return `CHF ${amount.toFixed(dec)}`;
}

// "Sunday, 19 May 2026" — for email bodies and other long-form display.
export function formatDateWithWeekday(input: string | Date | null | undefined): string | null {
  const d = toDate(input);
  if (!d) return null;
  const p = genevaParts(d);
  const day = parseInt(p.day, 10);
  const month = MONTHS_LONG[parseInt(p.month, 10) - 1];
  return `${p.weekday}, ${day} ${month} ${p.year}`;
}

// "Sunday" — for slot-aware reminder copy ("Friday morning").
export function formatWeekday(input: string | Date | null | undefined): string | null {
  const d = toDate(input);
  if (!d) return null;
  return genevaParts(d).weekday;
}

// "11:00" from a "HH:MM" or "HH:MM:SS" Postgres time string. Returns null
// for absent input. No timezone conversion — TIME values are already wall-clock.
export function formatStartTime(time: string | null | undefined): string | null {
  if (!time) return null;
  return time.slice(0, 5);
}

// Localized long date for the door check-in waiver subtitle, derived from the
// event's start_date so the legal text can never disagree with the DB (the
// original bug: a hardcoded "May 22" against a 21 May DB row — and 22 May was a
// Friday, not the stated Thursday).
//   en → "Thursday, May 21, 2026"   fr → "jeudi 21 mai 2026"
export function formatWaiverDate(
  input: string | Date | null | undefined,
  lang: "en" | "fr",
): string | null {
  const d = toDate(input);
  if (!d) return null;
  const p = genevaParts(d);
  const day = parseInt(p.day, 10);
  const monthIdx = parseInt(p.month, 10) - 1;
  const weekdayIdx = WEEKDAYS_LONG.indexOf(p.weekday as (typeof WEEKDAYS_LONG)[number]);
  if (lang === "fr") {
    const wd = weekdayIdx >= 0 ? WEEKDAYS_LONG_FR[weekdayIdx] : "";
    return `${wd} ${day} ${MONTHS_LONG_FR[monthIdx]} ${p.year}`.trim();
  }
  const wd = weekdayIdx >= 0 ? WEEKDAYS_LONG[weekdayIdx] : p.weekday;
  return `${wd}, ${MONTHS_LONG[monthIdx]} ${day}, ${p.year}`;
}

// ------------------------------------------------------------------
// Geneva-time math helpers (server-only consumers — cron, email)
//
// These exist for the same reason as the display formatters above:
// hand-rolled via formatToParts so output is byte-identical and
// timezone-correct regardless of runtime ICU. Don't reinvent.
// ------------------------------------------------------------------

const HOUR_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

// Return the (date, hour) of "now" in Europe/Zurich. Used by the cron
// scheduler to match the current hour against configured slot times.
export function nowInZurich(): { date: string; hour: number } {
  const parts = HOUR_FMT.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hourStr = get("hour");
  const hour = hourStr === "24" ? 0 : Number(hourStr);
  return { date: `${year}-${month}-${day}`, hour };
}

// Convert a Europe/Zurich-local (date, hour) to a UTC ISO instant. Used
// to compute firing instants for the registration created_at cutoff.
// Achieved by guessing UTC ± a window and reading back the zoned hour to
// lock onto the correct UTC value — DST-correct by construction.
export function zurichInstantToUtc(localDate: string, localHour: number): string {
  const naiveUtc = new Date(
    `${localDate}T${String(localHour).padStart(2, "0")}:00:00Z`
  );
  const parts = HOUR_FMT.formatToParts(naiveUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const seenAsZurichHour = get("hour") === "24" ? 0 : Number(get("hour"));
  const deltaHours = seenAsZurichHour - localHour;
  const adjusted = new Date(naiveUtc.getTime() - deltaHours * 3600 * 1000);
  return adjusted.toISOString();
}
