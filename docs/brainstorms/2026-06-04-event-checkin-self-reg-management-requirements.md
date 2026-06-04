---
date: 2026-06-04
topic: event-checkin-self-reg-management
title: Event Check-in & Self-Registration Management
scope: Deep — feature
---

# Event Check-in & Self-Registration Management — Requirements

## Summary

Give organizers a per-party view of guest self-registration — who has claimed a slot, how many remain, and that party's self-reg link/QR — surfaced two ways: expandable rows plus an "incomplete parties" filter in the admin Attendees list for pre-event chasing, and a scoped, volunteer-operable **door console** (reached by a per-event staff link) for event day, where staff search a party, see its fill and claimed list, show its QR, and watch arrivals.

---

## Problem Frame

M2 gave each paid party a self-registration link so guests add themselves to the roster, and the door is a strict gate (found by phone/email → in; not found → welcome desk). But nothing tells the organizer whether a party has actually filled its slots before the event, and nothing equips the people working the door on the day.

Pre-event, a lead may buy six tickets and never forward the link; today that party is one roster row with no visible "5 of 6 still unregistered" signal, so there's no way to chase it. On the day, the desk is run by volunteers, not the organizer — and when a guest who never self-registered walks up, the strict kiosk just says "see the welcome desk" with no next step. The volunteer has no way to look up the guest's party, confirm they're missing, and get them registered on the spot. The capability exists (the self-reg link); it's simply not surfaced where either the organizer (pre-event) or the volunteer (at the door) can act on it.

---

## Actors

- A1. Organizer / admin — full Manage Event access; chases under-filled parties pre-event and generates/shares the door-staff link.
- A2. Door volunteer — runs the desk on their own phone via the per-event door-staff link; minimal training, no other admin access.
- A3. Lead — bought the party's tickets; forwards the self-reg link to their guests.
- A4. Guest — self-registers via the link and checks in at the public kiosk.

---

## Key Decisions

- KD1. **Door access is a per-event secret link, not volunteer logins.** Volunteers operate the door console on their own phones with no real admin access and no account to provision. PII (party names, contacts, QR) sits behind the secret link — accepted as the same trust model as the existing kiosk and invite links.
- KD2. **The door console is a read-and-surface aid, not a write surface.** Guests still self-check-in and self-register on the existing public kiosk/self-reg pages; the console does not add attendees, mark arrivals, or edit the roster. This keeps the volunteer surface tiny and preserves the strict-gate and self-signed-waiver invariants.
- KD3. **Fill status is derived, not stored.** Because the self-reg cap model pre-provisions no placeholder rows (approach B), a party's unfilled slots are a number — purchased quantity minus claimed attendees — not a list of empty rows.
- KD4. **One per-party concept, two surfaces.** The same claimed-list + fill + link/QR appears in the full-admin Attendees expansion (pre-event) and in the scoped door console (event day).
- KD5. **Expected headcount is total tickets, not roster rows.** Arrival progress and the registration summary measure against tickets sold, so guests who haven't self-registered yet still count as expected.

---

## Requirements

**Pre-event self-registration management (admin)**

- R1. In the admin Attendees list, a lead row expands to show that party's claimed guests (name, contact, waiver status, arrived status) and the party's self-reg link + QR.
- R2. Each party shows fill status — claimed of purchased, e.g. 3 / 6 — derived as ticket quantity minus claimed-attendee count.
- R3. The admin can identify parties with unfilled slots (a filter or flag) and see a roster-wide summary of guests registered against total tickets (e.g. "18 of 35 guests registered").
- R4. The party's self-reg link is copyable, and its QR is viewable/downloadable, from the expanded party view; the QR encodes the existing per-registration self-reg URL.

**Door-staff access**

- R5. Each event has a per-event door-staff link (a secret token) that opens only the scoped door console — no other admin surface and no access to other events.
- R6. The organizer can view, copy, and regenerate the door-staff link; regenerating invalidates the previous one.
- R7. The door console is operable by an untrained volunteer on their own phone: large touch targets, minimal surface, one obvious action at a time.

**Door console & workflow**

- R8. The console lets staff search for a party by the lead's name or contact and see its fill status and claimed list (who has self-registered).
- R9. For a guest not on a party's claimed list, the console surfaces that party's self-reg QR for the guest to scan and self-register on their own phone.
- R10. The console shows live arrivals (who has checked in) and the arrived-against-expected count, where expected is total tickets.
- R11. The console performs no roster writes — it does not add attendees, mark check-ins, or edit rows; the only guest-facing action is showing the self-reg QR.

---

## Key Flows

- F1. Walk-up guest at the door
  - **Trigger:** A guest arrives at the desk.
  - **Actors:** A2, A4
  - **Steps:** Volunteer asks whether the guest already self-registered. If yes, the guest checks in at the kiosk by phone/email and is found → done. If they haven't, or the kiosk doesn't find them, the volunteer searches the guest's party in the console and checks its claimed list. If the guest isn't on it, the volunteer shows that party's self-reg QR; the guest scans it, self-registers (and may sign the waiver), then checks in at the kiosk.
  - **Covers:** R8, R9, R10, R11

- F2. Pre-event chase
  - **Trigger:** Organizer reviewing the roster before the event.
  - **Actors:** A1, A3
  - **Steps:** Organizer opens Attendees, reads the "X of Y guests registered" summary, and filters to parties with unfilled slots. They expand an under-filled party, copy its self-reg link, and forward it to the lead (directly or via Messaging).
  - **Covers:** R1, R2, R3, R4

---

## Acceptance Examples

- AE1. **Covers R2.** Given a party that bought 6 tickets with only the lead claimed; When the organizer views it; Then it shows 1 / 6 (5 slots open).
- AE2. **Covers R3.** Given one party fully filled and one with empty slots; When the admin filters to incomplete parties; Then only the under-filled party is listed, and the roster summary counts all claimed guests against total tickets.
- AE3. **Covers R8, R9.** Given a walk-up guest not on Diego's party list; When the volunteer searches Diego's party in the console; Then the claimed list shows the guest is missing and the console offers Diego's self-reg QR, which the guest scans to register and is then found at the kiosk.
- AE4. **Covers R5, R7, R11.** Given the door-staff link; When a volunteer opens it; Then they see only the door console (search, fill, claimed list, QR, arrivals) with no event settings, messaging, roster editing, or other events — even though party names and contacts are visible.
- AE5. **Covers R6.** Given the organizer regenerates the door-staff link; When someone opens the previous link; Then it no longer grants access.

---

## Scope Boundaries

**Deferred for later**

- Resending or nudging the self-reg link from the party view — the Messaging tab already covers reminders.
- Staff manually adding a guest to a party, or marking arrivals, from the door console.
- Lead-facing slot management beyond the link itself (already deferred in the roster plan).

**Outside this scope**

- Over-capacity walk-ups (a party's slots are all filled but an extra person arrives) — handled by welcome-desk judgment, not in the app.
- Restricted volunteer admin accounts — rejected in favor of the per-event secret link (KD1).

---

## Dependencies / Assumptions

- Builds on the shipped M2 self-registration link (per-registration `self_reg_token`, the claim RPC, and the public self-reg page) and the existing public door kiosk; the supporting migration is already applied.
- Assumes door volunteers have network-connected phones and the organizer has shared the door-staff link before the event.
- Assumes the public kiosk remains the guest's actual check-in and self-registration surface; the console only aids staff.

---

## Outstanding Questions (Deferred to Planning)

- Whether the door console is a brand-new scoped route or a token-gated rendering that reuses the existing Check-in tab components.
- The door-staff token's storage shape (e.g. a column on the event, mirroring the invite-code pattern) and how regeneration/revocation is modeled.
- Console search semantics (name/contact) and confirming that token-authenticated staff search is acceptable given the public matcher deliberately forbids roster enumeration.
</content>
