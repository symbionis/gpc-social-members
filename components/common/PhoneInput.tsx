"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  toE164,
  parseE164,
  countryOptions,
  DEFAULT_COUNTRY,
} from "@/lib/phone";

interface PhoneInputProps {
  /** When set, a hidden input carries the E.164 value for FormData submission. */
  name?: string;
  /** Existing stored E.164 value to edit (parsed back into country + national). */
  defaultValue?: string | null;
  /** Called with the E.164 string, or null when empty/invalid. */
  onChange?: (e164: string | null) => void;
  id?: string;
  required?: boolean;
  /** Larger control for kiosk / field use (bigger text + touch targets). */
  large?: boolean;
  /** Lock the control read-only (greyed, no dropdown). */
  disabled?: boolean;
}

// Region display names are resolved client-side only (in the open dropdown), so the
// closed control — which shows the static calling code — is identical on server and
// client and never triggers a hydration mismatch.
function useRegionName() {
  return useMemo(() => {
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      return (c: CountryCode) => dn.of(c) ?? c;
    } catch {
      return (c: CountryCode) => c;
    }
  }, []);
}

const fieldClassBase =
  "px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:bg-cream disabled:text-marine/60 disabled:cursor-not-allowed disabled:border-border";
const fieldClassLarge =
  "px-4 py-4 rounded-xl border-2 border-marine/20 bg-white text-marine font-body text-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky disabled:bg-cream disabled:text-marine/60 disabled:cursor-not-allowed disabled:border-border";

export default function PhoneInput({
  name,
  defaultValue,
  onChange,
  id = "phone",
  required = false,
  large = false,
  disabled = false,
}: PhoneInputProps) {
  const fieldClass = large ? fieldClassLarge : fieldClassBase;
  const parsed = parseE164(defaultValue);
  const [country, setCountry] = useState<CountryCode>(parsed?.country ?? DEFAULT_COUNTRY);
  const [national, setNational] = useState(parsed?.national ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [touched, setTouched] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => countryOptions(), []);
  const regionName = useRegionName();

  const e164 = toE164(national, country);
  const invalid = touched && national.trim() !== "" && e164 === null;

  // Notify the parent whenever the resolved value changes.
  useEffect(() => {
    onChange?.(e164);
    // onChange identity is not stable across renders in callers; depend on the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e164]);

  // Close the country dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.callingCode.includes(q) ||
        o.country.toLowerCase().includes(q) ||
        regionName(o.country).toLowerCase().includes(q),
    );
  }, [query, options, regionName]);

  const selected = options.find((o) => o.country === country);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { if (!disabled) setOpen((v) => !v); }}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`${fieldClass} ${large ? "w-32" : "w-28"} shrink-0 flex items-center justify-between gap-1`}
        >
          <span>
            {country} {selected?.callingCode}
          </span>
          <span aria-hidden className="text-muted-foreground">▾</span>
        </button>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          value={national}
          onChange={(e) => setNational(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="79 123 45 67"
          aria-invalid={invalid}
          required={required}
          disabled={disabled}
          className={`${fieldClass} flex-1 min-w-0`}
        />
      </div>

      {name ? <input type="hidden" name={name} value={e164 ?? ""} /> : null}

      {invalid ? (
        <p className="text-xs text-red-600 font-body mt-1">
          Enter a valid phone number for {regionName(country)}.
        </p>
      ) : null}

      {open ? (
        <div className="absolute z-20 mt-1 w-72 max-h-72 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code…"
              className={`${fieldClass} w-full py-2`}
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto">
            {filtered.map((o) => (
              <li key={o.country}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.country === country}
                  onClick={() => {
                    setCountry(o.country);
                    setOpen(false);
                    setQuery("");
                    setTouched(true);
                  }}
                  className={`w-full text-left px-3 py-2 font-body text-sm hover:bg-cream ${
                    o.country === country ? "bg-cream text-marine" : "text-marine"
                  }`}
                >
                  <span className="text-muted-foreground mr-2">{o.callingCode}</span>
                  {regionName(o.country)}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 font-body text-sm text-muted-foreground">
                No match
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
