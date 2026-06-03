// Pure parser/validator for the admin bulk-import roster (U3). Splits pasted text
// into `name, country, phone, email?` rows and flags malformed lines. Kept pure
// (no DB, no phone normalization) so it is trivially unit-testable; the route
// (app/api/admin/events/[id]/attendees/import/route.ts) normalizes the phone via
// lib/phone.ts toE164 afterwards and the SECURITY DEFINER RPC does the dedupe.

export interface ParsedImportRow {
  /** 1-based line number in the original pasted text (for the error report). */
  line: number;
  name: string;
  /** 2-letter ISO country (uppercased), e.g. "CH" / "FR". May be "" if omitted. */
  country: string;
  /** Raw national phone as pasted; "" when no phone column was given. */
  phone: string;
  /** Raw email as pasted (lowercased); "" when no email column was given. */
  email: string;
}

export interface ImportRowError {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseImportResult {
  rows: ParsedImportRow[];
  errors: ImportRowError[];
}

// A loose email check — the RPC and DB CHECK are the real guards; this only catches
// obviously-not-an-email column values so they surface as a row error rather than
// silently storing garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse pasted bulk-import text. One attendee per line, comma-separated:
 *   name, country, phone, email?
 * - country is a 2-letter ISO code (CH/FR/...). It is only required when a phone
 *   is supplied (it's what normalizes the phone); an email-only row may omit it.
 * - Blank lines (and all-whitespace lines) are ignored.
 * - A row needs a name AND at least one contact (phone or email), else it's an error.
 * Returns valid rows (with raw, un-normalized phone) plus a per-line error list.
 */
export function parseImportRows(text: string): ParseImportResult {
  const rows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];

  const lines = (text ?? "").split(/\r\n|\r|\n/);

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (raw.trim() === "") return; // ignore blank lines

    const cols = raw.split(",").map((c) => c.trim());
    const name = cols[0] ?? "";
    const country = (cols[1] ?? "").toUpperCase();
    const phone = cols[2] ?? "";
    const email = (cols[3] ?? "").toLowerCase();

    if (!name) {
      errors.push({ line, raw, reason: "Missing name" });
      return;
    }
    if (!phone && !email) {
      errors.push({ line, raw, reason: "Needs a phone or an email" });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ line, raw, reason: `Invalid email: ${email}` });
      return;
    }
    if (phone && !country) {
      errors.push({ line, raw, reason: "Phone given without a 2-letter country code" });
      return;
    }

    rows.push({ line, name, country, phone, email });
  });

  return { rows, errors };
}
