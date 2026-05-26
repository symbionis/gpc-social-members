---
date: 2026-05-26
topic: events-pdf-export
---

# Events PDF Export (Re-engagement One-Pager)

## Summary

Add an admin button to the events page that generates a clean, GPC-branded one-page PDF of upcoming events — designed to be shared in the members' WhatsApp group and printed for the clubhouse. Its primary job is to pull dormant members back into the member portal, so the header and footer carry a "log in to register" call-to-action with the portal URL and a QR code.

---

## Problem Frame

Some members are not logging into the member portal, so they miss upcoming events and don't register. The portal already lists events, but it only reaches members who are already active there — the people most in need of a nudge never see it. Today there is no quick, shareable artifact an admin can drop into the WhatsApp group or pin up at the club. This connects to the broader expired/dormant-member re-engagement track. The cost of the gap is low event awareness and registration among exactly the members who have drifted away from the portal.

---

## Requirements

**Trigger & generation**
- R1. The admin events page (`components/admin/EventManager.tsx`) has a clearly labelled button to generate/download the events PDF.
- R2. The PDF includes only events that are both **confirmed** and **published**.
- R3. The PDF includes only **future** events, using the same date logic as the existing past/future filter (`isPast()` compares `end_date || start_date` against today).
- R4. Events are listed in chronological order by start date. All matching upcoming events are included (no date-window cap in v1).

**Per-event content**
- R5. Each event shows: title, date (and end date if multi-day), start time, a short description, and the event type (category) as a small label/tag.
- R6. The PDF does **not** show location, pricing, or seat/capacity information.

**Branding & call-to-action**
- R7. The page uses GPC branding: club logo (`public/images/polo_club_logo.png`) and brand colors (marine `#052938`, sky `#95CEE1`, cream `#F8F6F2`).
- R8. Both the header and footer carry the login CTA message: "As a member, please log in to the member portal to register for the events."
- R9. The CTA includes the member-portal URL shown as text (tappable on WhatsApp) and a QR code (scannable from print).
- R10. The QR code and URL point to the member-portal login destination (`https://gpc-social-members-production.up.railway.app` unless a custom domain is finalized).

**Output quality**
- R11. The output is a real PDF suitable for both WhatsApp sharing and clean printing (legible at A4, no clipped content, no admin UI chrome).

---

## Acceptance Examples

- AE1. **Covers R2, R3.** Given an event that is published but not yet confirmed, when the admin generates the PDF, that event does not appear. Likewise a confirmed-but-unpublished event, a past event, and a draft are all excluded.
- AE2. **Covers R5, R6.** Given a confirmed, published, future event with a price and location set, when it appears on the PDF, it shows title/date/time/description/type but neither the price nor the location.
- AE3. **Covers R9, R10.** Given the PDF is printed and pinned at the club, when a member scans the QR code, they land on the member-portal login.
- AE4. **Covers R4.** Given multiple upcoming events, when the PDF is generated, they appear in chronological order by start date and the page flows onto additional pages if needed.

---

## Success Criteria

- An admin can produce the shareable PDF in one click, with no manual editing required before sending/printing.
- The artifact looks clean and on-brand both on a phone (WhatsApp preview) and on paper.
- Dormant members have a frictionless path back to the portal (tap the link or scan the QR), measurable as a lift in portal logins / event registrations after distribution.
- A downstream implementer can build it from this doc without inventing which events qualify, what fields show, or where the CTA points.

---

## Scope Boundaries

- Admin-only generation; the PDF is not a member-facing feature inside the portal.
- No location, pricing, or seat/capacity data on the PDF.
- No past, draft, unpublished, or unconfirmed events.
- No automated or scheduled distribution — an admin generates and shares it manually.
- No per-event imagery in v1 (clean text listing); revisit if it proves too plain.
- No date-window cap in v1 (lists all upcoming) — revisit if lists routinely run long.

---

## Key Decisions

- **Confirmed + published only**: the artifact is public-facing, so it must never leak tentative or hidden events.
- **Minimal per-event detail (no pricing/location)**: keeps it skimmable and enticing, and pushes detail resolution into the portal — reinforcing the re-engagement goal rather than answering everything on paper.
- **URL + QR together**: the two distribution channels need different affordances — a tappable link for WhatsApp, a scannable QR for print.
- **Manual, admin-triggered**: matches the actual workflow (admin drops it in WhatsApp / prints it) without building scheduling infrastructure.

---

## Dependencies / Assumptions

- Assumes events are all held at the club, so location is intentionally omitted; revisit if off-site events become common.
- Assumes "event type" is the event's category/type already modelled and shown in the admin EventManager.
- Assumes the member-portal login destination is the production Railway URL; a shorter custom domain would make the printed QR/URL cleaner but is not required.
- Depends on the existing `events` schema fields (title, start/end date, start time, description, type, `is_confirmed`, `is_published`) — all already present.

---

## Outstanding Questions

- Final QR/URL destination: portal root/login (`/login`) vs a dedicated events landing path — confirm at planning.
- Button label/placement within EventManager (e.g., near the future/past toggle).
