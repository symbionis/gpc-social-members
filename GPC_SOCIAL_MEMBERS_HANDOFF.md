# GPC Social Members — Development Handoff

## Project Overview

Build the MVP of the Geneva Polo Club Social Member Club membership management system. This is a custom web application with two interfaces: a **member-facing frontend** (signup, portal, digital card) and an **admin panel** (member management, application approvals, originator tracking).

**Target launch: Week of 31 March 2026.**

---

## Supabase Project

- **Project name:** GPC Social Members
- **Project ID:** `rmchkoktpzoojlglyfca`
- **Region:** eu-west-1
- **API URL:** `https://rmchkoktpzoojlglyfca.supabase.co`
- **Database host:** `db.rmchkoktpzoojlglyfca.supabase.co`
- **Dashboard:** `https://supabase.com/dashboard/project/rmchkoktpzoojlglyfca`
- **API keys:** Retrieve from Supabase Dashboard → Settings → API

### Current State of Database

The schema is fully deployed with 8 tables, RLS policies, triggers, and seed data. **39 migrated members** are already in the database.

### Tables

| Table | Purpose | Seeded? |
|---|---|---|
| `membership_tiers` | 5 tiers: Classic (€500), Elite (€1000), Corporate S/M/L | Yes — 5 rows |
| `admin_users` | Admin accounts with role-based permissions | Yes — 1 Super Admin (frank@syks.co) |
| `members` | Member records with tier, status, originator tracking | Yes — 39 migrated members |
| `payments` | Payment history per member per season | Empty — payments not yet migrated |
| `membership_cards` | Digital membership cards with QR codes | Empty — generated on activation |
| `applications` | Audit trail for vetting/approval process | Empty |
| `referrals` | Originator → member attribution tracking | Empty |
| `seasons` | Season dates and renewal windows | Yes — 2025 + 2026 |

### Enum Types

```sql
member_status: pending | approved | active | expired | suspended | declined
payment_status: free | pending | paid | overdue | refunded
admin_role: super_admin | team_admin
membership_category: individual | corporate
```

### Key Schema Details

- **Member numbers** auto-generate via trigger: `GPC-YYYY-NNNN` (e.g., GPC-2026-0001)
- **`updated_at`** auto-updates via trigger on: members, admin_users, membership_tiers, payments
- **RLS policies** enforce: members see own data, admins see all, super_admins manage everything, originators see own referrals only
- **Anonymous inserts** allowed on `members` table only when `status = 'pending'` (for signup form)

### Migrated Member Notes

- 39 individual members imported with `is_migrated = true`
- Original "Parrain" (originator) names stored in `metadata->>'original_parrain'` — to be linked to `originator_id` manually once originators are created as admin users
- Original status labels stored in `metadata->>'original_statut'` (Ambassador, Membre, Partenaire, etc.)
- 12 Sotheby's/Cardis corporate sub-members NOT yet migrated — they need the Phase 2 corporate sub-member model
- 2 members have placeholder emails (`*@migration.local`) — need real emails

---

## Brand Identity Reference

The app must reflect the Geneva Polo Club (Social) brand identity. Read-only reference page in Notion:

- **Notion page ID:** `32200430-c159-8177-b720-ef19a59ba014`
- **DO NOT write to this page** — it is approved and locked

### Visual Identity

| Element | Value |
|---|---|
| **Primary color** | Marine Blue `#052938` |
| **Secondary color** | Sky Blue `#95CEE1` |
| **White** | `#FFFFFF` |
| **Accent** | Red `#D42A1F` (sparingly) |
| **Heading font** | Playfair Display Bold (Capitals for H1, Mixed case for H2) |
| **Accent titles** | Poppins Extra Light (Capitals, Tracking 200) |
| **Body font** | Poppins Regular |
| **Font accent** | Teko Light (Capitals, Tracking 100) |
| **All fonts** | Available via Google Fonts |

### Voice & Tone Rules (for UI copy)

- **DO:** Let the experience speak for itself, address the reader as already part of the circle, use specific sensory details
- **DON'T:** Use "world-class", "unparalleled", "bespoke", "prestigious", "elite", "VIP", "luxury" (as noun), "networking event" in member-facing content
- **Preferred terms:** members (not clients), community (not network), gathering (not networking event), the club (not the venue), fieldside, season
- **Never abbreviate** to "GPC" — always "Geneva Polo Club" or "the club"
- **"Social Member Club"** — always capitalised, full name on first reference

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Database & Auth** | Supabase (Postgres 17, RLS, Auth) |
| **Frontend** | React (Next.js recommended) |
| **Payments** | Stripe (EUR) — not yet configured |
| **Translation** | Weglot (French layer on English codebase) |
| **Hosting** | TBD — Vercel recommended for Next.js |

---

## Phase 1 — MVP Features to Build

### 1. Signup Flow (Invitation-Only)

The signup enforces an invitation-only model. No open registration.

**Flow:**
1. Originator (Team Admin with `is_originator = true`) shares their unique invite link containing their `invite_code`
2. Prospect lands on a branded application page — originator's name is visible, pre-populated
3. Prospect fills application form:
   - Title (Mr/Mrs), First name, Last name, Email, Phone
   - Company / role (optional)
   - Brief note on connection to the originator
   - Membership tier selection (show individual tiers; corporate handled separately)
4. Application inserts into `members` table with `status = 'pending'`
5. Admin with `is_approval_committee = true` reviews and approves/declines in admin panel
6. On approval: `status` → `'approved'`, welcome email sent, Stripe payment link generated
7. On payment: `status` → `'active'`, digital card generated, member portal access granted

**Signup page design:**
- Marine Blue dominant, Sky Blue accents
- Playfair Display headings, Poppins body
- No generic luxury language
- Photography: natural light, fieldside, candid (placeholder images OK for MVP)
- Tone: personal, confident, peer-to-peer — like being welcomed to the club, not applying for a credit card

### 2. Admin Panel

Role-based access with two admin types:

**Admin Roles:**
- `super_admin` — full access to everything, sees all originators' data
- `team_admin` — scoped access, with optional boolean permission flags:
  - `is_originator` — gets unique invite link, sees own referrals/commissions in dashboard
  - `is_approval_committee` — can approve/decline membership applications

**Admin Panel Features:**

#### Application Queue
- List of pending applications with originator attribution
- Approve or decline with notes
- Creates entry in `applications` table as audit trail

#### Member Database
- Full list with search, filter by: tier, status, originator, join date, renewal date
- Member detail view: profile, payment history, membership dates, originator
- Export to CSV

#### Originator Management
- List of all Team Admins with `is_originator = true`
- Each has unique `invite_code` and generated invite link
- Super Admin sees all originators' referral data and commissions
- Team Admin with originator flag sees only their own

#### Package / Tier Management
- View/edit membership tiers: name, price, benefits, guest invitation limits
- Toggle tier active/inactive
- Stripe price ID linkage

#### Member CRUD
- Create new member manually (for walk-ins, special cases)
- Edit member details, change tier, update status
- Bulk operations: renewal reminders, status changes

### 3. Member Portal

Accessible after login (Supabase Auth). Basic for MVP.

#### Dashboard
- Welcome message with member's name
- Membership status and tier
- Season calendar (static for MVP)

#### Digital Membership Card
- Marine Blue background, club crest, member name in Playfair Display
- Tier badge, member number (GPC-2026-XXXX), validity dates
- QR code containing `card_number` from `membership_cards` table
- Scannable by admin at fieldside for check-in
- Option to save to phone home screen (add-to-homescreen PWA)

#### Profile
- View/edit personal details
- Communication preferences (email/SMS toggles)

#### Referral Link
- Members who are also originators can see their invite link
- Simple count of referred members and their status

### 4. Stripe Integration

- Create Stripe products/prices matching the 5 tiers
- Store `stripe_price_id` on `membership_tiers` table
- On approval: generate Stripe Checkout Session for the approved tier
- On successful payment: webhook updates `payments` table and sets member `status = 'active'`
- Handle "free" members (no Stripe session needed — admin marks as free)

### 5. Digital Card Generation

On member activation (`status = 'active'`):
- Generate unique `card_number` (format: `GPC-XXXX-XXXX`)
- Generate QR code data (encode: `card_number` + `member_id`)
- Insert into `membership_cards` table
- Card is rendered in the member portal as a styled component

---

## Phase 2 — Post-Launch (May–June 2026)

These are explicitly deferred. Do not build them now, but design the Phase 1 code with these in mind:

- Member directory (opt-in)
- Event RSVP and attendance tracking
- Guest invitation management
- Corporate sub-member accounts (primary contact + named sub-members with own cards and limited portal access)
- Partner offers section
- Attio CRM sync (custom API integration, not Zapier)
- Ada AI agent integration for automated communications

## Phase 3 — Summer 2026

- Reporting dashboard (membership, revenue, originator performance, engagement)
- Theo AI agent for business development insights
- Apple Wallet / Google Wallet digital card passes
- Annual member report generation
- Fieldside check-in mobile view

---

## Planning Document

The full planning doc with all decisions is in Notion:
- **Page:** "Membership Management System — Planning Document"
- **Location:** Social Member Polo Club (parent page)
- **Notion page ID:** `32d00430-c159-81b2-9742-e7b47f0455da`

---

## Key Decisions Summary

| Decision | Choice |
|---|---|
| Approval model | Membership approval committee — any admin with `is_approval_committee` flag |
| Guest invitations | Same limit for all tiers (configurable in admin) |
| Language | English primary, Weglot for French — one codebase |
| Originator model | Boolean flag on Team Admin (`is_originator`), no originator "types" |
| Corporate sub-members | Phase 2 — MVP has single primary contact per corporate membership |
| Pricing | €500 Classic, €1,000 Elite, €3k/6k/12k Corporate S/M/L |
| Ambassador status | Regular members for MVP, ambassador management in Phase 2 |
| Translation approach | Weglot JS integration, one-time French review pass for brand voice |

---

## Environment Variables Needed

```
NEXT_PUBLIC_SUPABASE_URL=https://rmchkoktpzoojlglyfca.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase Dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard>
STRIPE_SECRET_KEY=<to be configured>
STRIPE_PUBLISHABLE_KEY=<to be configured>
STRIPE_WEBHOOK_SECRET=<to be configured>
NEXT_PUBLIC_APP_URL=<deployment URL>
```

---

## File Structure Suggestion

```
/app
  /(public)
    /apply/[invite_code]     — Signup flow
    /login                   — Member login
  /(member)
    /dashboard               — Member dashboard
    /card                    — Digital membership card
    /profile                 — Profile management
  /(admin)
    /admin/dashboard         — Admin overview
    /admin/applications      — Application queue
    /admin/members           — Member database
    /admin/members/[id]      — Member detail
    /admin/originators       — Originator management
    /admin/tiers             — Tier/package config
/components
  /ui                        — Shared UI components
  /member                    — Member-facing components
  /admin                     — Admin components
  /card                      — Digital card components
/lib
  /supabase                  — Supabase client config
  /stripe                    — Stripe integration
  /utils                     — Helpers (QR generation, date formatting, etc.)
/hooks                       — Custom React hooks
/types                       — TypeScript types matching Supabase schema
```
