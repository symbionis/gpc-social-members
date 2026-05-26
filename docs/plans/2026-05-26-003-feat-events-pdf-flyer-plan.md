---
date: 2026-05-26
type: feat
status: completed
title: "feat: Events PDF flyer (printable upcoming-events one-pager)"
origin: docs/brainstorms/2026-05-26-events-pdf-export-requirements.md
depth: standard
---

# feat: Events PDF Flyer (Printable Upcoming-Events One-Pager)

## Summary

Add an admin button on the events page that opens a clean, GPC-branded HTML flyer of upcoming **confirmed + published** events. The admin prints it to PDF via the browser ("Save as PDF") to share in the members' WhatsApp group or pin up at the club. Header and footer carry a "log in to register" call-to-action with the member-events URL and a QR code, both pointing at `https://social.genevapolo.com/events`. The flyer's purpose is to pull dormant members back into the portal (see origin: `docs/brainstorms/2026-05-26-events-pdf-export-requirements.md`).

---

## Problem Frame

Some members no longer log into the portal, so they miss events and don't register. The portal already lists events but only reaches members who are already active there. There is no quick, shareable artifact an admin can drop into WhatsApp or print for the clubhouse. This connects to the broader dormant-member re-engagement track. The flyer is the artifact; its job is to drive a login.

---

## Approach (Key Technical Decision)

**Browser print-to-PDF via a dedicated, minimal-chrome HTML route — not server-side PDF generation.**

- The admin clicks a button in the events toolbar → a new tab opens a clean flyer page → the admin uses the page's "Print / Save as PDF" button (or Cmd/Ctrl+P) → the browser produces the PDF.
- Rationale: zero new dependencies (no Puppeteer/jsPDF/react-pdf), the browser handles pagination cleanly (origin R4 — flows onto extra pages), and it reuses existing fonts, brand colors, and the already-installed `qrcode.react`. This matches the brainstorm's low-carrying-cost preference. Server-side generation was rejected for its dependency weight and Railway cold-start cost with no offsetting benefit for a manually-shared artifact.
- The flyer route lives **outside** the `(admin)` route group (in a new `(print)` group) so it does not inherit the admin sidebar chrome — the on-screen view is exactly what prints. It is still admin-gated by an explicit guard in the page.

This illustrates the intended approach and is directional guidance for review, not implementation specification.

```text
EventManager toolbar button  ──opens new tab──▶  /print/events-flyer
                                                      │
                                       (admin auth guard; redirect if not admin)
                                                      │
                                   getFlyerEvents()  ─┤  is_published=true
                                                      │  AND is_confirmed=true
                                                      │  AND (end_date||start_date) >= today[Europe/Zurich]
                                                      ▼
                                       <EventsFlyer events=… url=… />
                                       header: logo + CTA + URL + QR
                                       list:   title · date/time · type · short description
                                       footer: CTA + URL + QR
                                                      │
                                       "Print / Save as PDF" (.no-print) → browser PDF
```

---

## Requirements Traceability

| Origin requirement | Covered by |
|---|---|
| R1 admin button to generate flyer | U4 |
| R2 confirmed + published only | U1 |
| R3 future only (isPast logic) | U1 |
| R4 chronological, all upcoming, paginates | U1 (sort), U3 (print CSS pagination) |
| R5 per-event: title, date/time, short description, type | U1 (data), U2 (render) |
| R6 no location / pricing / seats | U2 |
| R7 GPC branding (logo + colors) | U2, U3 |
| R8 login CTA message in header + footer | U2 |
| R9 CTA includes URL text + QR | U2 |
| R10 QR/URL → member-events login destination | U1 (URL constant), U2 |
| R11 clean printable PDF output | U3 (print CSS), U2 |
| AE1 exclusion rules | U1 (tests) |
| AE2 shows fields, hides price/location | U2 (tests) |
| AE3 QR → member login | U1/U2 (tests) |
| AE4 chronological, multi-page | U1, U3 |

---

## Key Technical Decisions

- **QR/URL target is a single known public URL**: `https://social.genevapolo.com/events`. The member-events page (`app/(member)/events/page.tsx`, URL `/events`) already redirects unauthenticated visitors to login, so scanning/tapping it nudges the dormant member to log in exactly as intended. Stored as a constant (overridable by env) to avoid the Railway internal-origin pitfall documented in `docs/solutions/integration-issues/railway-nextjs-supabase-env-and-url-config.md` — do **not** derive it from the request host.
- **All dates/times use `lib/format.ts` helpers** (`formatDate`, `formatDateTime`), never raw `toLocaleString`/`Intl.*.format`. The flyer is SSR-rendered and date-dense; raw locale formatting reintroduces the Safari React #418 hydration mismatch documented in `docs/solutions/runtime-errors/safari-hydration-mismatch-tolocale-formattoparts-2026-05-18.md`. `today` for the future-filter is computed in `Europe/Zurich`, not UTC, so Railway's UTC clock doesn't drop or keep an event on the wrong Geneva day.
- **Stricter filter than the member portal**: the member-events page filters `is_published=true` only and uses `start_date >= today`. The flyer additionally requires `is_confirmed=true` (origin K-decision: never leak tentative events on a shared artifact) and uses the origin's end-date-aware future logic `(end_date || start_date) >= today` so an in-progress multi-day event still shows.
- **Description is rendered as truncated plain text**: event `description` is rich text (Tiptap HTML). The flyer strips tags and truncates to a short single-line-ish snippet, keeping the page skimmable (origin: "short description").
- **Flyer logic lives in `lib/`, not in any `route.ts`**: per `docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md`, route files reject non-handler exports at Railway build time (passes local `tsc`, fails `next build`). This plan uses a `page.tsx` (which may export a default), but keeps the query/URL/truncation helpers in `lib/events/flyer.ts` for testability and to avoid that class of failure if a route file is ever introduced.
- **Admin gate is an additive shared helper**: a `requireAdminUser()` helper mirrors the existing inline check in `app/(admin)/layout.tsx` (auth user → `admin_users` role in `super_admin`/`team_admin`/`events_admin`). The new print route uses it; the existing layout is left untouched (no refactor in scope).

---

## Implementation Units

### U1. Flyer data layer and helpers

**Goal:** Provide the filtered event list, the CTA URL, and the description-shortening logic as testable functions.

**Requirements:** R2, R3, R4, R5, R10; AE1, AE3, AE4.

**Dependencies:** none.

**Files:**
- `lib/events/flyer.ts` (create)
- `lib/events/flyer.test.ts` (create)

**Approach:**
- `MEMBER_EVENTS_URL` constant = `https://social.genevapolo.com/events` (allow `process.env.NEXT_PUBLIC_MEMBER_EVENTS_URL` override, falling back to the constant). Never built from request host.
- `getFlyerEvents(supabase)`: select the fields needed for the flyer from `events` where `is_published=true` AND `is_confirmed=true` AND `(end_date ?? start_date) >= todayZurich`, ordered by `start_date` asc; resolve `event_type_id` → type name (fetch `event_types` and map, or join). Returns events already shaped with `typeName`. Mirror the query style in `app/(member)/events/page.tsx`.
- `todayInZurich()`: returns `YYYY-MM-DD` for the current date in `Europe/Zurich`. Reuse the existing Europe/Zurich "now" helper in `lib/format.ts` (~line 122) rather than writing a new one or using UTC `toISOString().slice(0,10)`.
- `shortenDescription(html, maxLen=160)`: strip HTML tags, collapse whitespace, trim, truncate on a word boundary with an ellipsis; returns `""` for null/empty.

**Patterns to follow:** event query shape in `app/(member)/events/page.tsx`; timezone/formatting conventions in `lib/format.ts`.

**Test scenarios** (`lib/events/flyer.test.ts`):
- `shortenDescription`: strips `<p>`/`<strong>`/`<a>` tags to plain text; collapses multiple whitespace/newlines to single spaces; truncates a long string at/under `maxLen` on a word boundary and appends an ellipsis; returns `""` for `null`, `undefined`, and `""`; leaves a short plain string unchanged.
- `MEMBER_EVENTS_URL`: equals `https://social.genevapolo.com/events` by default; uses the env override when set. **Covers AE3.**
- `todayInZurich`: for a known UTC instant late in a UTC day that is already the next day in Zurich (e.g. `23:30Z`), returns the Zurich calendar date, not the UTC date.
- `getFlyerEvents` (integration, with a seeded/mocked Supabase client): returns only rows that are published AND confirmed AND not past; excludes published-but-unconfirmed, confirmed-but-unpublished, and past rows; includes an in-progress multi-day event (start in past, `end_date` today/future); results ordered by `start_date` ascending; each returned event carries its resolved `typeName`. **Covers AE1, AE4.**

**Verification:** `lib/events/flyer.test.ts` passes; the query returns the expected subset against seeded data.

---

### U2. EventsFlyer presentational component

**Goal:** Render the branded one-page flyer markup from a list of flyer events.

**Requirements:** R5, R6, R7, R8, R9, R10; AE2, AE3.

**Dependencies:** U1.

**Files:**
- `components/events/EventsFlyer.tsx` (create)
- `components/events/EventsFlyer.test.tsx` (create)

**Approach:**
- Props: `events` (shaped by U1, each with `typeName`, dates, shortened description) and `memberEventsUrl`.
- Header: club logo (`public/images/polo_club_logo.png`), the CTA message ("As a member, please log in to the member portal to register for the events."), the URL as visible text, and a QR via `qrcode.react`'s `QRCodeSVG` (SVG prints crisply) encoding `memberEventsUrl`.
- Event list: for each event render title, formatted date (date range when `end_date` differs) via `formatDate`, start time via `formatDateTime`/`formatTime`, the event type as a small label/tag, and the short description. **Do not render location, price, or seat fields.**
- Footer: repeat the CTA message, URL text, and a QR.
- Styling uses existing brand CSS variables (marine `#052938`, sky `#95CEE1`, cream `#F8F6F2`) and the app fonts. Keep it a server component if `QRCodeSVG` renders without client hooks; otherwise isolate the QR in a tiny `"use client"` wrapper.

**Patterns to follow:** `QRCodeSVG` usage in `components/.../MembershipCard.tsx`; date helpers in `lib/format.ts`; brand tokens in `app/globals.css`.

**Test scenarios** (`components/events/EventsFlyer.test.tsx`):
- Given a list of events, renders each event's title, formatted date, time, and type label. **Covers AE2 (fields shown).**
- The CTA login message appears in **both** the header and the footer.
- The member-events URL text and a QR element are present in header and footer. **Covers AE3.**
- Given an event with `location` and a price set in its data, the rendered output contains neither the location nor the price. **Covers AE2 (fields hidden).**
- A multi-day event (different `start_date`/`end_date`) renders a date range rather than a single date. **Covers AE4.**
- Empty event list renders the branded header/footer and an "no upcoming events" placeholder (no crash).
- Dates are produced via `lib/format.ts` (no raw `toLocale*` in the component) — assert against the Zurich-formatted expected string.

**Verification:** component tests pass; visual check shows on-brand header/list/footer.

---

### U3. Print route, minimal layout, print CSS, and admin guard

**Goal:** Serve the flyer at an admin-gated, minimal-chrome route that prints to a clean PDF.

**Requirements:** R1 (target of the button), R7, R11; AE1.

**Dependencies:** U1, U2.

**Files:**
- `app/(print)/layout.tsx` (create) — minimal layout: html/body with fonts + globals, no admin sidebar, no member nav/footer.
- `app/(print)/print/events-flyer/page.tsx` (create) — server component; URL `/print/events-flyer`.
- `lib/auth/admin.ts` (create) — `requireAdminUser()` shared guard.
- `app/(print)/print.css` or a scoped `<style>` (create) — print stylesheet.
- `app/(print)/print/events-flyer/page.test.tsx` or a Playwright spec under `tests/` (create) — route/auth test.

**Approach:**
- `requireAdminUser()`: get the auth user, look up `admin_users` by email, allow roles `super_admin`/`team_admin`/`events_admin`, else `redirect("/admin/login")` (unauthenticated) / `redirect("/admin/login?error=unauthorized")` (wrong role) — the exact targets `app/(admin)/layout.tsx` uses today, not the member `/login`. The auth check runs **before** `getFlyerEvents()` so no event data is fetched for an unauthorized request. Mirrors `app/(admin)/layout.tsx` (additive; that layout is not modified).
- Page: call `requireAdminUser()`, then `getFlyerEvents()`, render `<EventsFlyer />` plus a `.no-print` "Print / Save as PDF" button that calls `window.print()` (tiny client component). No auto-print (avoids surprising the admin during preview).
- Print CSS: A4 page size with sensible margins; `print-color-adjust: exact` / `-webkit-print-color-adjust: exact` so brand backgrounds/colors render; hide `.no-print`; `break-inside: avoid` on event rows so an event isn't split across a page break; repeat-friendly header/footer treatment.

**Patterns to follow:** admin check in `app/(admin)/layout.tsx`; route-group layout pattern used by `(admin)`/`(member)`.

**Test scenarios:**
- A non-admin (no `admin_users` row, or a disallowed role) requesting `/print/events-flyer` is redirected/blocked, not shown the flyer. **Covers AE1 (access).**
- An allowed admin role receives the rendered flyer containing only confirmed+published+future events. **Covers AE1.**
- Empty upcoming set renders the placeholder, not an error.
- Print CSS: the `.no-print` print button is not present in print rendering (assert the class/rule exists; full print fidelity verified manually).

**Verification:** loading `/print/events-flyer` as an admin shows the flyer; Cmd/Ctrl+P (or the button) yields a clean, paginated, on-brand PDF preview; non-admins cannot view it.

---

### U4. EventManager export button

**Goal:** Give admins a one-click entry point to the flyer from the events page.

**Requirements:** R1.

**Dependencies:** U3 (route must exist).

**Files:**
- `components/admin/EventManager.tsx` (modify)
- `components/admin/EventManager.test.tsx` (create or modify, if a test file exists)

**Approach:** Add an "Events Flyer (PDF)" button to the events toolbar near the existing "Add Event" control. It opens `/print/events-flyer` in a new tab (`target="_blank"`, `rel="noopener"`). No data is passed through the URL — the print page fetches its own authoritative filtered set.

**Patterns to follow:** existing toolbar buttons in `components/admin/EventManager.tsx` (styling, lucide icon usage).

**Test scenarios:**
- The toolbar renders an "Events Flyer" button.
- The button targets `/print/events-flyer` and opens in a new tab.

**Verification:** clicking the button on the admin events page opens the flyer in a new tab.

---

## Scope Boundaries

Carried from origin (`docs/brainstorms/2026-05-26-events-pdf-export-requirements.md`):
- Admin-only; not a member-facing portal feature.
- No location, pricing, or seat/capacity data on the flyer.
- No past, draft, unpublished, or unconfirmed events.
- No automated/scheduled distribution — the admin saves and shares manually.
- No per-event imagery in v1 (clean text listing).
- No date-window cap in v1 (lists all upcoming).

### Deferred to Follow-Up Work
- A shorter branded vanity URL / dedicated landing page for the QR (current target `social.genevapolo.com/events` is fine).
- Server-side PDF generation with a true download button, if manual "Save as PDF" proves insufficient.
- Capturing the print-to-PDF + QR tooling decision as a `docs/solutions/` learning via `/ce-compound` (first in this area for the team).

---

## System-Wide Impact

- New route group `(print)` and route `/print/events-flyer`; no change to existing `(admin)`/`(member)` routes.
- New `requireAdminUser()` helper in `lib/auth/admin.ts` — additive; existing admin layout untouched.
- One modified existing file: `components/admin/EventManager.tsx` (additive button).
- No schema changes, no migrations, no new dependencies.

---

## Risks and Mitigations

- **Safari hydration mismatch on dates** → use `lib/format.ts` helpers everywhere; a pre-ship `grep` for `toLocale`/`new Intl.` in the new files guards against regression.
- **Railway build failure from route-file exports** → keep helpers in `lib/events/flyer.ts` and `lib/auth/admin.ts`; run `npm run build` locally before pushing (local `tsc` won't catch it).
- **QR encoding an unreachable URL** → use the fixed public URL constant, never the request host.
- **Print color/background dropped by browsers** → set `print-color-adjust: exact`; verify in Chrome print preview.
- **Rich-text description leaking markup or running long** → `shortenDescription` strips tags and truncates; covered by tests.

---

## Deferred Implementation-Time Unknowns

- Exact `event_type` join vs. separate fetch-and-map (depends on the `events`/`event_types` relation in code).
- Whether `QRCodeSVG` renders in a server component or needs a small client wrapper (resolve on first render).
- Final print margins / page-break tuning (iterate against Chrome print preview).

---

## Verification Strategy

- Unit tests for `lib/events/flyer.ts` (filter, URL, truncation, Zurich date) and `components/events/EventsFlyer.tsx` (fields shown/hidden, dual CTA, QR).
- Route/auth test for `/print/events-flyer` (admin allowed, non-admin blocked).
- Manual check: as an admin, open the flyer, confirm only confirmed+published+future events show with title/date/time/type/short description and no location/price; print preview is clean, paginated, on-brand, with header+footer CTA and a scannable QR resolving to `https://social.genevapolo.com/events`.
- `npm run build` locally before pushing.
