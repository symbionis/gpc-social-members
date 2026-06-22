---
date: 2026-06-05
topic: my-booking-page
title: "My Booking" — Lead Self-Service Page
scope: Deep — feature
---

# "My Booking" — Lead Self-Service Page — Requirements

## Summary

Give the **lead** (the person who booked) a single self-service page, reached by a unique per-booking link, where they can: see a **summary of their booking**, **fill in / edit each guest's details** (the same editable per-ticket slots the door console uses), **add their children** as name-only slots, and **share the guest pre-registration link/QR** with people who'd rather self-enter. One lead-facing surface that replaces the awkward path of a lead re-using the guest "add yourself" form to manage their party.

---

## Problem Frame

M1/M2 shipped two roster-fill surfaces — the **guest self-registration link** (low-trust, "add yourself", shareable with anyone in the party) and the **door console** (event-day, staff, editable per-ticket slots). But the **lead has no home of their own**. Today, a lead who wants to fill in their guests or add their kids before the event has to open the *guest* self-reg link, which says "Add yourself to the guest list" even though they're already registered. Re-submitting it works only if they re-enter the exact contact they booked with (the claim is idempotent); a different contact silently creates a duplicate adult, and the form can't add children without an accompanying adult submission.

So the lead — the one person most motivated to get their whole party's details in before the day — is the only actor without a fit-for-purpose surface. The capability exists (editable slots, save-attendee endpoint, children flow, QR — all built for the door console); it just isn't pointed at the lead behind their own link.

---

## Actors

- A1. Lead — booked the party's tickets; wants to see their booking and fill in / share details for their guests and kids before the event.
- A2. Guest — an adult in the party who self-registers via the shareable guest link (unchanged).
- A3. Child — a name-only attendee the lead adds on their booking page; checked in via an accompanying adult at the door.
- A4. Admin / door staff — already have the admin roster and door console; "My booking" is the lead-facing equivalent, not a replacement for theirs.

---

## Key Decisions (proposed — to confirm at planning)

- KD1. **Separate, higher-trust lead token — NOT the shared guest token.** `self_reg_token` is meant to be forwarded to guests ("add yourself"), so it's low-trust. "My booking" exposes the *whole* party's contacts + payment status and lets the lead edit everyone — higher trust. Add a distinct `manage_token` (CSPRNG, per registration) so a guest who got the shareable link can't open the lead's management view. The guest token stays the "add yourself" link.
- KD2. **Manage attendees, not the order.** The lead can fill/edit guest details, add children, and share the guest link — but **cannot** change ticket types, quantities, or anything with payment implications. Order changes remain admin-only.
- KD3. **Reuse the door-console building blocks.** The editable per-ticket **slot model** (filled + open slots per type, from `buildDoorRoster`), the **save-attendee** create/update endpoint, the **children** add flow, and the **QR** already exist. "My booking" is the door console's party card scoped to one registration and authed by the lead token, not the public event id.
- KD4. **Entry point = the confirmation email.** Add a "**Manage your booking**" button (lead token) alongside the existing "Pre-register guests" share block (guest token). Possibly also surface it on the member's events page when logged in.
- KD5. **Kids handled here, properly.** Children appear as name-only slots the lead fills in directly — removing the need for the guest form's "add yourself + kids" coupling. (The guest self-reg form's optional-adult fix becomes unnecessary if the lead manages kids here, though it's still a nice-to-have for non-lead adults bringing kids.)

---

## Page Contents (first cut)

1. **Booking summary** — event title, date/time, location, reference code, ticket breakdown (e.g. "3 × Without Asado, 3 × Without Asado (kid)"), payment status / total.
2. **Your party** — editable slots, one per purchased ticket: filled rows pre-populated and editable (name + email/phone; kids name-only), open slots blank and fillable, each labelled with its ticket type. Per-row save (reuse `save-attendee`).
3. **Share** — copy/send the guest pre-registration link + QR for guests who'd rather self-enter.
4. (Maybe) **Status nudges** — "2 of 6 guests still missing details", mirroring the admin fill badge.

---

## Open Questions

- Q1. Auth model: a plain unguessable `manage_token` link (like the kiosk/invite links), or gate behind member login when the lead is a member? Token link is simplest and works for non-member leads.
- Q2. Should the lead be able to **remove/clear** a guest slot (vs only edit)? The door console dropped "Remove" in favour of editing; same likely applies.
- Q3. Do we still want the **guest self-reg form's optional-adult fix** (so a non-lead adult can add their own kids), or does "My booking" cover enough that we defer it?
- Q4. Member-facing surface: also link "My booking" from the logged-in member's events list, not just the email?
- Q5. Do we reuse the same React slot components across the door console and "My booking", or fork (different chrome, same logic)?

---

## Out of Scope (for this feature)

- Changing the order (ticket types, quantities, refunds) — admin-only.
- The door-staff console and admin roster — unchanged; "My booking" is additive.
- Payment / Stripe changes.

---

## Reuse Inventory (already built — de-risks the lift)

- `lib/events/door-access.ts` `buildDoorRoster` — per-type filled/open **slot model**.
- `POST /api/public/door/[id]/save-attendee` — create/update a slot (race-safe per-type cap; adult needs contact, kid name-only).
- `add_self_registration_children` RPC + `/registrations/[token]/children` — name-only kids.
- `components/door/DoorConsole.tsx` `SlotRow` — the editable slot UI + `PhoneInput`.
- QR + share-link rendering (door console + admin AttendeeList).
- Confirmation email already carries `self_registration_url`; add a `manage_url`.
