// Deterministic Geneva-time formatters. Used by every admin component that
// renders a date or amount. Why hand-rolled instead of direct toLocale*:
// Safari and Node ICU disagree on the whitespace character inserted between
// time parts in `en-GB` (U+202F vs U+0020), which triggers React #418
// hydration mismatches. We extract only numeric parts via formatToParts and
// assemble the final string ourselves so server and client produce identical
// bytes.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const GENEVA_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type Parts = { year: string; month: string; day: string; hour: string; minute: string; second: string };

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
