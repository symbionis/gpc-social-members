---
title: Adopt libphonenumber-js for E.164 phone normalization across every entry point
date: 2026-06-04
category: tooling-decisions
module: lib/phone
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "Collecting, storing, or comparing phone numbers anywhere in the app (member profile, application form, event registration, door check-in, admin bulk-import)"
  - "Matching records by phone, where an inconsistent E.164 string causes a silent lookup failure"
  - "Handling countries whose national numbers keep the trunk/leading 0 (e.g. Italy) — a blanket /^0/ strip corrupts them"
tags:
  - phone
  - e164
  - libphonenumber-js
  - normalization
  - door-check-in
  - italy-leading-zero
---

# Adopt libphonenumber-js for E.164 phone normalization (never hand-roll the trunk-zero rule)

## Context

The event door check-in matches an arrival to a pre-claimed roster **by phone** (and email). The matcher in `lib/events/checkin.ts` (`matchContact`) does an exact-equality lookup on the stored E.164 string:

```ts
// lib/events/checkin.ts
.eq("phone_e164", phone)   // phone is expected already in E.164
```

Exact equality means the *write path* and the *match path* must produce byte-identical E.164 for the same human number. If they diverge, a correctly-registered guest silently fails to match and is turned away at the door ("not registered — please see the welcome desk").

The original capture (pre-PR-#38, `lib/dial-codes.ts` + per-form logic) built E.164 by picking a dial code from a hand-maintained list and blanket-stripping the national leading zero:

```ts
// BEFORE — repeated in ProfileForm / ApplicationForm
const [dialCode, setDialCode] = useState("+41");          // from lib/dial-codes.ts
const localPhone = (form.get("phone") as string).replace(/^0/, ""); // unconditional strip
const phone = localPhone ? `${dialCode}${localPhone}` : "";
```

`replace(/^0/, "")` is correct for CH/FR/DE/UK (the trunk `0` is dropped in international format) but **wrong for Italy**: IT keeps the leading `0` *inside* the national number. Rome `06 6982 1234` must become `+390669821234`, not `+39669821234`. The same Italian number entered at registration vs. at the door produced two different stored strings — and the match failed.

## Guidance

Never hand-roll phone normalization. Per-country trunk-zero rules differ and a regex cannot encode them. Use `libphonenumber-js`, and route **every** writer and the matcher through **one shared module** so they cannot diverge.

PR #38 introduced `lib/phone.ts` wrapping `libphonenumber-js`:

```ts
// lib/phone.ts
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

// Stored E.164 -> { country, national } for re-editing an existing value
export function parseE164(stored: string | null | undefined): PhoneParts | null {
  if (!stored) return null;
  const parsed = parsePhoneNumberFromString(stored.trim());
  if (!parsed || !parsed.country) return null;
  return { country: parsed.country, national: String(parsed.nationalNumber) };
}
```

Design points:

- **Country is an explicit, required input** — `toE164(national, country)`. The library applies the correct per-country trunk-zero rule; the caller never decides whether to strip a `0`.
- **Invalid / too-short returns `null`**, not a malformed string. Callers gate on it (`PhoneInput` shows "Enter a valid phone number for …" and submits empty).
- **One module, every entry point.** `components/common/PhoneInput.tsx` is the single capture control (country combobox + national field, emits E.164 via a hidden input / `onChange`). It is adopted at the member profile, the public application form, event registration, and the door check-in. The door matcher compares against that same E.164. Writers and matcher physically cannot diverge because they share `lib/phone.ts`.

## Why This Matters

The failure mode is **silent and customer-facing**: no error, no log, no crash — just a real guest, correctly registered, told at the door they aren't on the list. It only affects countries with a kept trunk zero (Italy), so it survives testing done with Swiss/French numbers. The only signal is in-person friction the engineering team never sees.

It also illustrates the deeper trap: a normalization function that lives in two places (or is re-implemented per form) **will** drift. Centralizing on one shared module turns "keep N call sites consistent" into "there is only one call site." (The check-in code does the same for email via the shared `normalizeEmail`.)

## When to Apply

- Any time a phone number is captured, stored, or compared — normalize to E.164 via `lib/phone.ts` (`toE164` / `PhoneInput`), never string concatenation or regex.
- Any time two code paths must agree on a normalized identity (phone, email, slug) for a lookup/match: extract one normalization function and have **both** the writer and the reader import it.
- Whenever you see `.replace(/^0/, "")`, a dial-code lookup table, or manual `+CC` string-building for phones — treat it as a bug and replace it with the library.
- New phone entry points: reach for the existing `PhoneInput`; don't build a bespoke field.

## Examples (before / after)

**Before** — hand-rolled, country-blind, duplicated per form:

```ts
const localPhone = (form.get("phone") as string).replace(/^0/, ""); // wrong for IT
const phone = localPhone ? `${dialCode}${localPhone}` : "";
// "06 6982 1234" + IT  ->  "+39669821234"   ❌ corrupted; door match fails
```

**After** — library-backed, country-aware, one shared module:

```ts
import { toE164 } from "@/lib/phone";

toE164("078 123 45 67", "CH"); // "+41781234567"   (trunk 0 stripped)
toE164("06 6982 1234",  "IT"); // "+390669821234"  (internal 0 KEPT)  ✅
toE164("12",            "CH"); // null             (too short -> rejected, not stored)
```

These contrasts are pinned in `lib/phone.test.ts` so a future "simplification" back to a regex strip fails the suite:

```ts
it("strips the trunk zero for CH/FR/DE/UK", () => {
  expect(toE164("078 123 45 67", "CH")).toBe("+41781234567");
});
it("keeps the internal leading zero for Italian numbers", () => {
  expect(toE164("06 6982 1234", "IT")).toBe("+390669821234");
});
```

## Prevention notes

- `lib/dial-codes.ts` (the old hand-maintained dial-code list) is now **orphaned** — no importers remain. It's dead code from the pre-PR-#38 approach and can be deleted in a follow-up.
- Treat the matcher and PhoneInput as a pair: any new place that *reads* phones for comparison must use the same `lib/phone.ts` normalization the *writers* use.

## See also

- `docs/solutions/conventions/jsonb-filter-singular-to-plural-evolution.md` — same shape of principle (normalize at one IO boundary, in one place per surface).
- `docs/solutions/design-patterns/draft-row-claim-and-transition-2026-05-06.md` — same event check-in / roster subsystem, different concern.
