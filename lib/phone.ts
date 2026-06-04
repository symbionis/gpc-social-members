import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

// Shared phone capture + normalization. Every phone entry point (member profile,
// application, event registration, door check-in, admin bulk import) goes through
// here so the same human number compares equal wherever it was entered.
//
// We use libphonenumber-js rather than the old hand-rolled `replace(/^0/, "")`
// concat because trunk-zero handling is per-country: CH/FR/DE/UK strip the leading
// 0, but IT keeps it inside the national number. A blanket strip corrupted Italian
// numbers and caused door mismatches.

// Countries pinned to the top of the selector, in display order. "UK" is ISO "GB".
export const PINNED_COUNTRIES: CountryCode[] = ["FR", "CH", "GB", "DE", "IT", "ES"];

export const DEFAULT_COUNTRY: CountryCode = "CH";

export interface PhoneParts {
  country: CountryCode;
  national: string;
}

// Normalize a national number entered under `country` to E.164, or null if the
// number is not a valid phone number for that country. libphonenumber applies the
// correct per-country trunk-zero rule.
export function toE164(national: string, country: CountryCode): string | null {
  const trimmed = (national ?? "").trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164, e.g. "+41781234567"
}

export function isValidPhone(national: string, country: CountryCode): boolean {
  return toE164(national, country) !== null;
}

// Split a stored E.164 value back into country + national number, for re-editing
// an existing value in the PhoneInput control. Returns null when the stored value
// can't be parsed (caller should fall back to the default country, empty field).
export function parseE164(stored: string | null | undefined): PhoneParts | null {
  if (!stored) return null;
  const parsed = parsePhoneNumberFromString(stored.trim());
  if (!parsed || !parsed.country) return null;
  return { country: parsed.country, national: String(parsed.nationalNumber) };
}

export interface CountryOption {
  country: CountryCode;
  callingCode: string; // e.g. "+41"
}

// Ordered country list for the selector: pinned countries first (FR/CH/UK/DE/IT/ES),
// then every other country alphabetically by ISO code. The component decorates each
// with a localized display name; the calling code is kept here so node-side callers
// (and tests) don't depend on Intl locale data.
export function countryOptions(): CountryOption[] {
  const all = getCountries();
  const rest = all
    .filter((c) => !PINNED_COUNTRIES.includes(c))
    .sort((a, b) => a.localeCompare(b));
  const ordered = [...PINNED_COUNTRIES.filter((c) => all.includes(c)), ...rest];
  return ordered.map((country) => ({
    country,
    callingCode: `+${getCountryCallingCode(country)}`,
  }));
}
