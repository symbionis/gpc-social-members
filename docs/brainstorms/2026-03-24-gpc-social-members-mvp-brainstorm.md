# GPC Social Members — MVP Brainstorm

**Date:** 2026-03-24
**Status:** Complete
**Target launch:** Week of 2026-03-31

---

## What We're Building

A membership management system for the Geneva Polo Club Social Member Club with three interfaces:

1. **Signup flow** — Invitation-only application page (`/apply/[invite_code]`)
2. **Admin panel** — Member management, application approvals, originator tracking (`/admin/*`)
3. **Member portal** — Dashboard, digital membership card, profile (`/dashboard`, `/card`, `/profile`)

Plus: Stripe payments, Postmark transactional emails, PWA for card home screen save.

---

## Why This Approach

- **Next.js on Railway** — Full Node.js runtime, no edge function constraints, cron jobs and background scripts in-app
- **Supabase Auth with magic link** — Passwordless, simple, secure. No passwords to manage.
- **Separate admin/member login** — Clean separation of concerns, different redirect flows
- **Postmark via Next.js API routes** — All logic in one codebase, easy to test, fits Railway model
- **PWA** — Lightweight manifest + service worker so members can save digital card to home screen

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | Railway | Full Node.js, cron jobs, no edge function reliance |
| Auth method | Supabase magic link | Passwordless, simple UX |
| Admin auth | Separate `/admin/login` | Clean separation from member flow |
| Member auth | `/login` page | Magic link, redirects to member portal |
| Email provider | Postmark | Existing account, reliable transactional email |
| Email sending | Next.js API routes | All logic in one codebase, no Supabase Edge Functions |
| Send-from address | juliette@genevapolo.com | Verified domain in Postmark |
| QR code format | URL (`/verify/GPC-XXXX-XXXX`) | Future-proof for when scanning is built |
| Invalid invite codes | Branded error page | "This invitation is no longer valid" with club branding |
| Translation | Weglot bolted on at end | English-first codebase, French layer added last |
| Corporate sub-members | Phase 2 | MVP has single primary contact per corporate tier |
| QR scanning | Deferred | Card displays QR but no scan/verify page yet |
| PWA | In scope | Manifest + service worker for card home screen save |

---

## Phase 1 Scope

### 1. Signup Flow (`/apply/[invite_code]`)
- Validate invite code against `admin_users.invite_code` where `is_originator = true`
- Show originator name, branded application form
- Collect: title, name, email, phone, company/role (optional), originator connection note, tier selection
- Insert into `members` with `status = 'pending'`, `originator_id` set
- Invalid/expired invite code shows branded error page

### 2. Admin Panel (`/admin/*`)
- **Login:** Separate `/admin/login` with magic link, checks `admin_users` table
- **Application queue:** List pending, approve/decline with notes, audit trail in `applications`
- **Member database:** Search, filter (tier, status, originator, dates), detail view, CSV export
- **Originator management:** List originators, invite codes/links, referral counts
- **Tier management:** View/edit tiers, toggle active/inactive, Stripe price ID linkage
- **Member CRUD:** Create manually, edit details, change tier/status, bulk operations

### 3. Member Portal (`/dashboard`, `/card`, `/profile`)
- **Login:** `/login` with magic link, checks `members` table
- **Dashboard:** Welcome, membership status/tier, season calendar (static)
- **Digital card:** Marine Blue card with crest, name, tier badge, member number, QR code, validity dates
- **Profile:** View/edit personal details, communication preferences
- **Referral link:** If member is also an originator, show invite link + referral count

### 4. Stripe Integration
- Create products/prices for 5 tiers
- On approval: generate Stripe Checkout Session
- On payment success: webhook updates `payments`, sets `status = 'active'`
- Handle free members (admin marks, no Stripe session)

### 5. Postmark Emails
- Welcome email on approval (with payment link)
- Decline notification
- Payment confirmation + card ready
- Sent from: juliette@genevapolo.com

### 6. Digital Card + PWA
- Generate `card_number` (GPC-XXXX-XXXX) on activation
- QR code encodes URL: `{APP_URL}/verify/{card_number}`
- PWA manifest + service worker for "Add to Home Screen"

### 7. Error Handling
- Duplicate applications (same email already pending/active)
- Expired/invalid invite codes (branded error page)
- Payment failures (Stripe handles retry, status stays `approved`)
- Expired magic links (Supabase handles, show re-send option)

---

## Out of Scope (Phase 2+)

- Member directory
- Event RSVP / attendance
- Guest invitation management
- Corporate sub-member accounts
- Partner offers
- Attio CRM sync
- QR code scanning / verify page
- Apple/Google Wallet passes
- Reporting dashboard
- Weglot integration (end of Phase 1, but after core features)

---

## Brand Rules (Quick Reference)

- Colors: Marine Blue `#052938`, Sky Blue `#95CEE1`, White, Red `#D42A1F` (sparingly)
- Headings: Playfair Display Bold | Body: Poppins Regular | Accent: Teko Light
- Never say: "world-class", "bespoke", "prestigious", "elite", "VIP", "luxury", "networking event"
- Never abbreviate to "GPC" — always "Geneva Polo Club" or "the club"
- Tone: personal, confident, peer-to-peer
