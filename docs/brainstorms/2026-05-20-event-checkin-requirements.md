---
date: 2026-05-20
topic: event-checkin
---

# Event Door Check-In

## Summary

A per-event, self-service door check-in. Each event exposes a public check-in URL with a downloadable QR poster. Guests scan it on their own phones, pick FR/EN, enter name and email, accept the liability waiver, and get a green confirmation screen to show the check-in clerk. Emails are matched against the event's registrations and the member directory; unmatched people check in as invited guests. Waiver acceptance is stored as a defensible per-person record. The admin "Attendees" page becomes "Manage Event" with Registrations and Settings tabs.

---

## Problem Frame

The club's first big event is coming up, and guests will arrive at the door with no automated way to be processed. Without a system, a clerk would manually find each person on a printed list, collect a paper waiver signature, and handle invited guests who were never on any list — a slow, error-prone bottleneck at the entrance, and a weak liability position if an incident later occurs and waiver signatures are missing or unattributable.

Three populations show up at the same door: people who registered online, members who didn't register but are entitled to attend, and guests invited by someone else. The current registration system tracks only the first group, and check-in was explicitly deferred from registration v1 (the admin attendees list has a manual status field but no door-facing flow). The waiver (FR/EN PDFs in `docs/`) currently lives entirely outside the product.

---

## Actors

- A1. Registered attendee: Bought/reserved a spot online; their email is in `event_registrations`.
- A2. Walk-up member: A club member who didn't register; recognized via the member directory.
- A3. Invited guest: Has no registration and isn't a member; names who invited them.
- A4. Check-in clerk: Stands at the door, eyeballs each guest's green confirmation screen, waves them in. Does no data entry.
- A5. Admin / organizer: Copies the check-in link and QR from Manage Event, sets the strict check-in toggle, and reviews who has arrived.

---

## Key Flows

- F1. Matched attendee check-in
  - **Trigger:** Guest scans the event QR poster on their own phone.
  - **Actors:** A1 / A2, A4
  - **Steps:** Pick FR/EN → enter name + email → email matches a registration or a member → read + accept waiver → green confirmation screen → show clerk.
  - **Outcome:** A per-person check-in record exists with a waiver audit record; clerk admits guest.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R12

- F2. Invited guest check-in
  - **Trigger:** Guest scans the QR; their email matches neither a registration nor a member.
  - **Actors:** A3, A4
  - **Steps:** Pick FR/EN → enter name + email → no match → "who invited you?" field appears (required) → accept waiver → green confirmation screen.
  - **Outcome:** A guest check-in record exists carrying the inviter name + waiver audit record.
  - **Covered by:** R5, R9, R10, R12

- F3. Strict-mode rejection
  - **Trigger:** Strict check-in is on; an unmatched guest tries to check in.
  - **Actors:** A3, A4
  - **Steps:** Enter name + email → no match → blocked with a localized "please see the desk" message; no self-check-in.
  - **Outcome:** No record created; clerk handles manually.
  - **Covered by:** R16

- F4. Admin setup
  - **Trigger:** Organizer prepares for the event.
  - **Actors:** A5
  - **Steps:** Open Manage Event → Settings → copy check-in URL / download QR poster → set strict check-in toggle as desired.
  - **Outcome:** A printable QR poster and the correct strict policy for the door.
  - **Covered by:** R13, R15, R16

---

## Requirements

**Guest check-in flow**
- R1. Each event has a public, unauthenticated check-in page at a per-event URL (following the existing public event pattern keyed by event id), distinct from the registration page.
- R2. The whole flow is bilingual: an FR/EN toggle controls all labels, fields, buttons, the waiver text, and the confirmation message.
- R3. The guest enters their name and email to begin check-in.
- R4. On submit, the email is matched (case-insensitive, trimmed) first against this event's registrations, then against the member directory.
- R5. If matched (registration or member), proceed to the waiver. If unmatched and strict check-in is off, reveal a required "who invited you?" free-text field before the waiver.
- R6. The liability waiver is shown inline in the selected language; the guest must tick acceptance to complete check-in.
- R7. On acceptance, record the check-in and show a full-screen green confirmation containing a personalized message (the guest's name and their status: registered / member / guest) intended to be shown to the clerk.

**Matching and records**
- R8. A walk-up member (email matches the member directory, no registration) is recorded as a member check-in.
- R9. An invited guest (no match) is recorded as a guest check-in carrying the inviter name.
- R10. Each check-in is an individual per-person record; companions on a multi-seat registration check in individually rather than being checked in by the registrant.
- R11. A repeat check-in for the same person is idempotent: show the green screen again noting the original check-in time, and do not create a second record.

**Waiver audit**
- R12. For each check-in, store: accepted = true, timestamp, the name and email entered, the language chosen (FR/EN), and an identifier for the waiver version/file accepted.

**Admin — Manage Event**
- R13. Rename the admin event "Attendees" page to "Manage Event" with a Registrations tab and a Settings tab.
- R14. The Registrations tab keeps the existing attendee list, waitlist, and CSV export, adds a check-in status per person, and shows walk-in guests and walk-up members alongside online registrations (one "who's in the room" view).
- R15. The Settings tab shows the public check-in URL (copyable) and a downloadable QR poster encoding it, plus the strict check-in toggle.
- R16. The strict check-in toggle is per-event and defaults to off. When on, only people matched to a registration or the member directory can check in; unmatched guests are blocked with a localized message. When off, unmatched people check in as invited guests and are not blocked by the event's seat cap.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Given a guest whose email matches a paid registration, when they submit name + email, they proceed directly to the waiver with no "who invited you?" field.
- AE2. **Covers R5, R9.** Given a guest whose email matches neither a registration nor a member and strict check-in is off, when they submit, the required "who invited you?" field appears before the waiver, and on acceptance a guest record carrying the inviter is created.
- AE3. **Covers R8.** Given a member who never registered, when they submit their member email, they are recognized as a member and proceed to the waiver without the invited-guest field.
- AE4. **Covers R11.** Given a guest already checked in at 14:32, when they scan and submit again, they see the green screen noting they checked in at 14:32 and no second record is created.
- AE5. **Covers R16.** Given strict check-in is on and a guest matches neither a registration nor a member, when they submit, they are shown a localized "please see the desk" message and cannot self-check-in.
- AE6. **Covers R16.** Given an event that is fully booked online and strict check-in is off, when an invited guest checks in at the door, the check-in succeeds (the seat cap governs online registration, not the door).

---

## Success Criteria

- Guests self-check-in at the door with no clerk data entry; the clerk only verifies the green screen and admits them.
- Every checked-in adult has a defensible waiver record (name, email, timestamp, language, waiver version).
- The organizer can produce the check-in link and QR poster and set the strict policy without developer help, and can see who has arrived in the Registrations tab.
- A downstream planner can build the flow without inventing matching rules, strict-mode semantics, the bilingual scope, or where walk-in/guest check-ins are stored.

---

## Scope Boundaries

- Live arrivals dashboard (running count, auto-refresh event-day view) — deferred; check-in status is visible in the Registrations tab but not live.
- Clerk-operated check-in device — not built; the model is self-service on the guest's own phone.
- Whole-party / single-tap group check-in — not supported; each adult checks in individually so each accepts their own waiver.
- Cryptographic or anti-fraud proof on the green screen — not built; the green screen is a soft visual signal, accepted given low fraud risk for a club social event.
- Payment or new paid registration at the door — out of scope; paid registration stays online, the door handles check-in only.
- Minor / guardian waiver handling — out of scope; this event is adults-only, so each attendee accepts their own waiver. Revisit if a future event admits under-18s.

---

## Key Decisions

- Self-service on the guest's own phone with one QR poster per event; the green screen is the clerk's "all clear" signal: Removes the clerk as a data-entry bottleneck and lets the waiver be captured per person at scale.
- Match against registrations and the member directory, not registrations alone: A member who walks up without registering should be recognized, not treated as a stranger.
- Individual per-person check-in; a registration's `quantity` is informational: A liability waiver should be accepted by each adult, so companions check in (and sign) individually.
- Full per-person waiver audit record over a simple flag: Defensible if an incident is ever challenged.
- Strict check-in as a per-event admin toggle, default off: The door policy (admit invited walk-ins vs. registered/members only) differs by event and belongs to the organizer.
- Walk-in guests and walk-up members surface in the Registrations tab alongside online registrations: One place to see everyone in the room, rather than a separate check-ins surface.
- "Who invited you?" is a free-text field: Simplest capture; no invite/guest-list infrastructure assumed.

---

## Dependencies / Assumptions

- `event_registrations` already carries name, email, is_member, quantity, status, reference_code, checked_in_at, event_id, and registration_id (verified). Public events are keyed by UUID `id` (verified); the check-in URL is assumed to follow the same pattern.
- A member directory exists for email matching. The exact source table and the match query are to be confirmed in planning.
- The waiver text lives in `docs/WAVER GPC privat EVENT en.pdf` and `docs/WAVER GPC privat EVENT fr.pdf` as PDFs. The check-in page renders waiver text in-app (not the PDF binary), so the FR/EN content must be extracted into localized in-app content with a version identifier.
- No QR generation exists in the codebase today; a generation approach must be chosen in planning.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R8][Technical] The exact member-directory source/table and the matching query.
- [Affects R6, R12][Needs research] Extracting the FR/EN waiver text from the PDFs into localized in-app content, and the version-identifier scheme stored on each acceptance.
- [Affects R15][Technical] QR generation approach (library vs. service) and where the poster is rendered and downloaded.
- [Affects R8, R9, R10][Technical] Where walk-in guest and walk-up member check-ins are stored (extend `event_registrations` vs. a dedicated check-in table), given they have no pre-existing registration row.
