---
date: 2026-06-22
topic: event-qr-access-flow
title: "Event Access Flow — Per-Ticket QR Credential, Forwarding & Staff Info-Desk Check-In"
scope: Deep — feature
origin: FEAT-41 (Event access & ticketing control — QR + NFC bracelet)
---

# Event Access Flow — Per-Ticket QR Credential, Forwarding & Staff Info-Desk Check-In — Requirements

## Summary

Make each purchased ticket a **bearer QR credential**: every ticket gets its own QR from the moment it's bought, and that QR is the entry token whether or not a name is attached yet. It's a standard nominative ticket system — names come from the lead, the guest, or check-in — whose value-add is sending tickets to guests through the platform. The buyer (lead) distributes tickets by **forwarding batches** to other people — John buys 10, sends 4 to Simon, Simon gets an email with his 4 tickets + QRs and runs his own party from there — and can **buy more tickets from the booking page** and send those too. On the day, staff at a staffed **info desk** scan each guest's QR to mark them in and hand over a bracelet; if the scanned QR has no name or waiver yet, staff fill it in on the spot (email/phone encouraged, not mandatory). This replaces today's self-service "scan the poster, type your email" check-in. The credential is designed so an NFC bracelet (paired at the desk, tapped at bar/asado checkpoints) can layer on later — but no NFC is built here.

---

## Problem Frame

GPC events are outdoors with a porous perimeter: there is no single gate, and bar/asado staff are too busy mid-service to verify anyone. Today's shipped check-in (FEAT-32) is self-service — a guest scans a per-event poster, types their phone or email, and the system matches them against the `event_attendees` roster. That model has two structural limits:

1. **Identity is asserted, not carried.** A guest checks in by typing contact details that match the roster; there is no token a person actually holds. Codes can't be made single-use, and the screen can't hand anyone the physical bracelet that authorises bar/asado service.
2. **Distribution is awkward.** A buyer of many tickets has no clean way to hand a subset to someone else who'll manage their own sub-group. The roster has per-person rows and a single shared self-reg link, but no notion of "here are your 4 tickets, you take it from here."

The fix is to make the ticket itself the credential. A QR per ticket is a bearer token: it can be forwarded, it works before a name is attached, and identity/waiver is filled in whenever convenient — online by whoever holds it, or at the desk on arrival. The pieces to build on already exist: a per-person roster (`event_attendees`), a guest self-registration link, a specced lead "My Booking" page, per-person waiver capture, and a staffed door console that can edit slots on the fly.

---

## Actors

- A1. **Lead / buyer** — purchased the tickets; distributes them by forwarding batches to other people and/or filling in names directly, from their booking page.
- A2. **Delegate** — someone the lead forwards a batch of tickets to (Simon). Receives the tickets + QRs by email and manages that sub-group: fills in names or just hands the QRs on.
- A3. **Ticket holder / guest** — anyone holding a ticket QR, named or not. Presents it at the info desk. A child ticket is held and presented like any other.
- A4. **Info-desk staff** — scan each arriving QR, fill in name/waiver if missing, mark check-in, hand over a bracelet. Handle lost-QR lookups in the same console.

---

## Key Decisions

- **KD1. The credential is one QR per ticket, as a bearer token.** A QR identifies one ticket/slot, which may or may not have a name attached. Holding the QR is what gets you in; identity is metadata filled in whenever. This is the new primitive — everything else (booking page, self-reg, waiver, door console) is reused.
- **KD2. QRs are minted per ticket at purchase, valid before any name.** All purchased tickets carry a QR immediately. A ticket with no name and no waiver is still a valid entry token; the gaps are filled at distribution time or at the desk.
- **KD3. Distribution is by forwarding batches, and the lead can buy more.** The lead can select some of their purchased tickets and send them to another person, who receives an email with just those tickets + QRs and manages that sub-group. From the same page the lead can also purchase additional tickets and distribute them the same way. The booking page is fundamentally a "send tickets to your guests" surface, not only a per-slot name form.
- **KD4. Name and waiver fill in anytime — online or at the door.** A scanned QR with no name/waiver is completed on the spot at the info desk. Email/phone is encouraged but not mandatory; waiver is captured then. Online (booking page / delegate's page) is the encouraged path, the desk is the fallback.
- **KD5. Kids are just tickets.** No guardian-link or special QR routing. A child ticket type still exists for pricing, but a kid's QR is held and presented like any other ticket; name filled and waiver handled (by the accompanying adult) at the desk if not done online.
- **KD6. Check-in inverts to staff-scans-guest, and the self-service poster is retired.** All check-in happens at the staffed info desk by scanning the QR — a self-service screen can't hand out a bracelet. Lost-QR holders are found by name/contact lookup in the same console.
- **KD7. Purchased quantity is the hard limit.** Tickets are finite; forwarding and walk-ups can never create entries beyond what was bought. The existing race-safe per-type cap is the enforcement mechanism.
- **KD8. NFC is deferred but designed-for.** The per-ticket credential is the future pairing key: a scan would code/pair an NFC bracelet, checkpoints would validate by tap. Nothing NFC is built now, but issuance and the desk step must not preclude it.

---

## Key Flows

- F1. **Lead distributes tickets**
  - **Trigger:** Lead opens their booking page (from the confirmation email or member events list).
  - **Actors:** A1, A2, A3
  - **Steps:** Lead sees all their purchased tickets, each with a QR. They can (a) forward a batch to another person by email, (b) fill in names/contact for tickets directly, (c) keep tickets to hand out themselves, and/or (d) buy more tickets and distribute those too. The confirmation page leads with the invitation to send tickets to guests and states clearly that everyone needs their own QR to get in.
  - **Covered by:** R1, R2, R3, R4, R9, R16

- F2. **Delegate receives and manages a batch**
  - **Trigger:** Delegate opens the email forwarding them N tickets.
  - **Actors:** A2, A3
  - **Steps:** Delegate gets just their N tickets + QRs. They can fill in names for their sub-group or simply forward/hand each QR to the person who'll use it.
  - **Covered by:** R3, R4

- F3. **Guest arrives and is checked in**
  - **Trigger:** Guest presents a ticket QR at the staffed info desk.
  - **Actors:** A3, A4
  - **Steps:** Staff scan the QR → the ticket opens → if name is missing, staff fill it in (email/phone encouraged, not required); if waiver is unsigned, capture it → mark checked in → hand over bracelet. A QR that's already been used is idempotent (shows the original check-in, no second bracelet).
  - **Covered by:** R5, R6, R7, R8

- F4. **Lost QR**
  - **Trigger:** Guest arrives without a usable QR.
  - **Actors:** A3, A4
  - **Steps:** Staff search the console by name or contact, find the ticket, and check in / hand a bracelet as in F3. Works only for tickets that already carry a name.
  - **Covered by:** R10

- F5. **Walk-up with no ticket**
  - **Trigger:** Person arrives with no QR, says an existing party invited them.
  - **Actors:** A4
  - **Steps:** Staff search the inviter's party; if it has an unredeemed ticket, staff fill it for the walk-up (name + optional contact) and check them in. If the party has no spare ticket, there's no room on those tickets — purchased quantity is the limit (KD7).
  - **Covered by:** R11, R12

---

## Requirements

### Credential issuance

- R1. Each purchased ticket gets a unique, unguessable bearer credential rendered as a QR, minted at purchase.
- R2. A ticket's QR is a valid entry token even with no name and no waiver attached; identity and waiver are not prerequisites for the QR to exist or work.

### Distribution & booking page

- R3. The lead can forward a selected batch of their purchased tickets to another person by email; that person receives an email containing only those tickets and their QRs.
- R4. A recipient of forwarded tickets (or the lead) can fill in names/contact for their tickets, or pass the QRs on without filling anything.
- R9. The booking/confirmation page leads with the distribution call to action — invite the purchaser to send tickets to their guests — and states clearly that every attendee needs their own QR to enter. Each ticket's QR is visible/shareable from this page.
- R16. From the booking page the lead can purchase additional tickets and then distribute them (forward or fill) the same way as their original tickets.

### Info-desk check-in

- R5. Info-desk staff can scan a ticket QR and have the matching ticket resolved and displayed (ticket type, name if present) for the bracelet hand-off.
- R6. Scanning marks the ticket checked in. A repeat scan is idempotent — it shows the original check-in time and does not prompt a second bracelet.
- R7. If the scanned ticket has no name, staff fill it in on the spot. Email and phone are encouraged but not mandatory; a name alone is enough to complete check-in.
- R8. If the scanned ticket's waiver is unaccepted, staff capture it in one tap before completing check-in; if already accepted, check-in is a pure scan.
- R10. Staff can find a ticket by name or contact lookup in the same console for guests who arrive without a usable QR (works only for tickets that already carry a name/contact).

### Walk-ups & quantity

- R11. Staff can accommodate a walk-up only by redeeming an unredeemed ticket in the inviter's party — filling it with the walk-up's name + optional contact and checking them in.
- R12. Purchased quantity is the hard limit per party. If the inviter's party has no unredeemed ticket, the walk-up cannot be admitted on those tickets. The existing race-safe per-type cap enforces this — no override past purchased quantity.

### Kids

- R13. Children are ordinary tickets (a child ticket type exists for pricing). A kid's QR is held and presented like any other ticket; name and waiver are filled online or at the desk by the accompanying adult. No guardian-link or special QR routing is built.

### Retiring self-service

- R14. The public self-service door check-in (guest scans poster → types email → green confirmation) is removed. All check-in flows through the staffed info-desk console.

### NFC readiness (design-for, not build)

- R15. The per-ticket credential and the info-desk step are designed so a future NFC bracelet can be paired/coded at the desk against the same credential, and checkpoints can validate by tap — without reworking issuance or check-in. No NFC behaviour is implemented in this iteration.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a buyer purchases 10 tickets, when the purchase completes, then 10 distinct QRs exist and each is a valid entry token even though none has a name yet.
- AE2. **Covers R3, R4.** Given John bought 10 tickets, when he forwards 4 to Simon, then Simon receives an email containing exactly those 4 tickets and their QRs, and Simon can fill in names for them or hand the QRs on unchanged.
- AE3. **Covers R7.** Given a guest presents a QR with no name attached, when staff scan it, then staff are prompted to enter a name (email/phone optional) and check-in completes with a name alone.
- AE4. **Covers R6.** Given a QR has already been scanned in, when staff scan it again, then the console shows the original check-in time and does not prompt a second bracelet.
- AE5. **Covers R8.** Given a ticket's waiver was never accepted online, when staff scan its QR, then a one-tap waiver capture is required before the bracelet is handed over.
- AE6. **Covers R11, R12.** Given an inviter's party of 4 still has 1 unredeemed ticket, when staff admit a walk-up against it, then that ticket is filled and checked in. Given instead all 4 are already redeemed, the walk-up cannot be admitted on those tickets.

---

## Scope Boundaries

**Deferred for later**
- NFC bracelets, checkpoint readers, the bracelet coding device, and offline-resilient checkpoint allowlists — a later phase building on the credential from R15.
- Bar/asado-side validation stations (tap or present-and-scan) — depends on the NFC phase.
- Apple/Google Wallet passes for the per-ticket QR.

**Out of scope for this feature**
- Whether and how a walk-up with no available ticket could buy one at the desk — payment at the desk is a separate concern (overlaps FEAT-34).
- Reducing quantity, refunds, and editing already-purchased tickets — admin-only, unchanged. (Buying *additional* tickets from the booking page is in scope — R16.)

---

## Dependencies / Assumptions

- Builds on the shipped roster + check-in stack: `event_attendees` (per-person rows, waiver fields, `checked_in_at`), the guest `self_reg_token` flow, the door console (`lib/events/door-access.ts` `buildDoorRoster`, `POST /api/public/door/[id]/save-attendee`), and the "My Booking" lead page specced in `docs/brainstorms/2026-06-05-my-booking-page-requirements.md`.
- Assumes a ticket/slot can exist as a valid QR-bearing entry token with no name attached — an extension of today's "unclaimed slot," which currently holds no contact.
- Assumes the info desk is staffed and is the single point where physical bracelets are issued; there is no unstaffed self-service path after R14.
- The race-safe per-type claim cap (`20260604120000_self_registration_token_and_claim.sql`) already rejects fills beyond purchased quantity; R12 relies on this behaviour unchanged.

---

## Outstanding Questions

**Deferred to planning**
- Q1. Credential unit and token model: is the QR keyed on an `event_attendees` slot row, or a distinct per-ticket credential? (R1/R2 imply per-ticket; confirm against the existing slot model.)
- Q2. Forwarding mechanics: does each forward generate a new per-recipient link/email scoped to that batch, and can a delegate re-forward further? (Spec assumes one forward level with a per-batch email; deeper nesting is a nice-to-have.)
- Q3. Whether each forwarded ticket carries its own QR in the email or a single batch QR scanned N times — R-level assumes per-ticket QRs so individual guests can arrive separately.
- Q4. Exact QR encoding and the scan surface in the staff console (camera vs. external scanner).
- Q5. Buy-more checkout (R16): reuse the existing event purchase/Stripe flow inline on the booking page, or hand off to the standard checkout and return? (Anti-sharing is explicitly not a concern at this stage — single-use is just check-in idempotency, not a control we're hardening.)

---

## Sources / Research

- Grounding dossier: `/tmp/compound-engineering/ce-brainstorm/feat41/grounding.md` (file:line citations for the current roster, check-in, self-reg, and door-console code).
- Prior brainstorms: `docs/brainstorms/2026-05-20-event-checkin-requirements.md`, `docs/brainstorms/2026-06-03-event-guest-roster-checkin-requirements.md`, `docs/brainstorms/2026-06-04-event-checkin-self-reg-management-requirements.md`, `docs/brainstorms/2026-06-05-my-booking-page-requirements.md`.
- Prior plans: `docs/plans/2026-04-27-001-feat-event-registration-plan.md`, `docs/plans/2026-06-03-001-feat-event-guest-roster-checkin-plan.md`, `docs/plans/2026-06-04-001-feat-checkin-self-reg-management-plan.md`.
- Source feature: FEAT-41 in the Notion "🛠 Product Features" database (16 Jun event strategy meeting).
</content>
