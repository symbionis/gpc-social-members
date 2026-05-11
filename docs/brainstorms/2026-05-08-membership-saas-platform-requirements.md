---
date: 2026-05-08
topic: membership-saas-platform
---

# Membership SaaS Platform — Founding Brief

## Summary

A standalone SaaS membership platform for exclusive clubs and organizations (50–500 members) that operate without dedicated staff. One product with two go-to-market hooks: an operational backbone that automates membership lifecycle, events, and communications; and an AI comms agent that acts as the club's on-brand content producer through a single chat. The platform is multi-tenant, configurable per organization, and priced in tiers where the agent layer is the premium differentiator.

---

## Problem Frame

Private and social clubs in the 50–500 member range — polo clubs, yacht clubs, dining clubs, city clubs, professional associations, chambers of commerce — run their operations manually or with cobbled-together generic tools. The club manager (often a volunteer or part-time role) chases renewals in spreadsheets, manually tracks who's expired, sends event invitations from personal email, and has no unified view of membership health.

The existing software market offers no good fit. Enterprise club management suites (Jonas, Clubessential, Northstar) cost $3K–$15K/month and are built for golf and country clubs with POS, tee sheets, and F&B — overbuilt and overpriced for social clubs. Lightweight tools (Wild Apricot, Join It, Memberful) are built for nonprofits or content creators — they handle billing but not the curated admission, committee approval, or exclusivity management that defines a private club. Wild Apricot, the incumbent by market share, is in decline following acquisition: support collapsed, prices rose, features stagnated.

The result: most exclusive clubs either commission an agency for a custom build ($500K+), hire a part-time admin to manually wrangle tools, or accept that operational tasks consume the manager's time instead of member experience and growth.

The second pain — and the one club managers feel most acutely — is communications. Without dedicated staff, newsletters go unsent, social media goes quiet, event promotion is last-minute, and the club's brand voice is inconsistent. The comms burden is what makes the manager role unsustainable, and it's what a brand-aware AI agent can uniquely solve.

Switzerland and the broader DACH region is particularly underserved: no identified vendor targets Swiss private clubs, US tools create GDPR/Swiss DSG friction, and language fragmentation (FR/DE/IT) compounds adoption barriers.

---

## Actors

- A1. **Club manager**: Runs day-to-day operations — member admin, renewals, events, communications. Often part-time, volunteer, or wearing multiple hats. Primary user of both the admin panel and the comms agent.
- A2. **Club founder**: Setting up a new members' club and needs to be operational fast — configuring tiers, onboarding flow, branding, first events. Uses the platform intensively during setup, then transitions to club manager mode.
- A3. **Originator / referrer**: Existing member or board member who invites prospective members via a personal invite link. Doesn't use the admin panel daily but needs their link to work and wants visibility into who they've referred.
- A4. **Approval committee**: Reviews and approves/declines membership applications. May be the club manager, a board, or a dedicated group. Needs a lightweight queue, not a full admin experience.
- A5. **Member**: Applies, pays, receives a digital card, browses events, registers, manages their profile. Interacts with the member portal and public-facing pages.
- A6. **Prospective member / public visitor**: Discovers the club through a public event listing or a shared invite link. Sees events at non-member pricing, encounters the membership value proposition, may apply.
- A7. **Comms agent** (external system): AI agent connecting via the platform API. Drafts broadcasts, creates/edits events, previews audiences, and pulls reference data (tiers, event types, seasons). Operates within the club's brand identity. Separate product; the platform provides the API surface.

---

## Key Flows

- F1. **Club onboarding (new organization)**
  - **Trigger:** Club founder signs up for the platform
  - **Actors:** A2
  - **Steps:** Create organization account, configure branding (colors, logo, name), set up membership tiers with pricing, configure onboarding flow (invite-only or open application), invite first originators, publish first event
  - **Outcome:** Club is operational — invite links work, applications flow to approval, payments process, members receive cards
  - **Covered by:** R1, R2, R3, R4

- F2. **Member acquisition via events (conversion engine)**
  - **Trigger:** Public visitor discovers a public event listing
  - **Actors:** A6, A5, A3, A4
  - **Steps:** Visitor sees public event with non-member pricing, encounters members-only events they can't access, follows invite link or applies, application enters approval pipeline, on approval and payment the visitor becomes a member with full access and member pricing
  - **Outcome:** Event calendar drives membership growth through visible exclusivity gap
  - **Covered by:** R8, R9, R10, R11

- F3. **Automated membership lifecycle**
  - **Trigger:** Time-based (approaching expiry, past expiry)
  - **Actors:** A1, A5
  - **Steps:** System sends multi-stage renewal reminders before expiry, auto-expires memberships past end date, deactivates digital cards, sends expiry notification, optionally triggers re-engagement outreach for lapsed members
  - **Outcome:** Renewals happen without manual chasing; expired members are cleanly handled
  - **Covered by:** R6, R7

- F4. **Agent-powered communications**
  - **Trigger:** Club manager opens chat with comms agent, or agent acts on a scheduled cadence
  - **Actors:** A1, A7
  - **Steps:** Manager asks agent to draft a newsletter / create an event / promote upcoming events on social. Agent uses platform API to pull member data, event details, audience segments. Agent produces on-brand content. Manager reviews draft in platform admin. Manager approves send.
  - **Outcome:** Club communications happen consistently and on-brand without the manager writing copy or managing multiple tools
  - **Covered by:** R14, R15, R16

---

## Requirements

**Organization and branding**

- R1. Each organization is a fully isolated tenant with its own members, events, tiers, admins, and configuration
- R2. Organization branding is configurable by the club manager: colors, logo, organization name, and tone/voice settings — applied across the member portal, public pages, emails, and digital card
- R3. Membership tiers are fully manageable from the admin UI: create, edit, reorder, activate/deactivate, set pricing, define benefits, configure guest invitations per season
- R4. Stripe payment integration uses dynamic checkout (price from tier record) — no pre-created Stripe Products or Prices required per organization

**Member lifecycle**

- R5. Invite-only application flow: originators get personal invite links, prospective members apply through branded forms, applications enter committee approval pipeline with configurable reviewers
- R6. Automated renewal lifecycle: multi-stage reminder emails before expiry, automatic expiry on end date, card deactivation, expiry notification to member
- R7. Expired member re-engagement: bulk outreach to lapsed members with reactivation pathway
- R8. Honorary/complimentary membership path: invite flow that bypasses payment, configurable per organization

**Events and calendar**

- R9. Events support public and members-only visibility, with the distinction visible to public visitors (members-only events shown as locked/teaser or hidden, per org preference)
- R10. Dual pricing: member price and non-member price per event, with member pricing visible only to authenticated members
- R11. Event registration with payment processing (Stripe checkout), attendee tracking, and confirmation emails
- R12. Event types are configurable per organization (categories, color coding), with season-based grouping

**Communications and messaging**

- R13. Broadcast messaging with rich text composition, audience targeting (by status, tier, or combination), consent-aware delivery (respects marketing opt-out), per-recipient delivery tracking, and a draft/review/send workflow
- R14. Agent API surface: authenticated REST endpoints for listing/creating/editing events, drafting broadcasts, previewing audience counts (no PII in count-only endpoints), and pulling reference data (tiers, event types, seasons)
- R15. Agent API enforces a draft-only constraint for content creation — the agent can draft broadcasts and events, but only a human admin can approve and send/publish
- R16. Agent API is designed for external AI agent consumption: consistent response shapes, stable authentication, and action tracking for observability

**Member experience**

- R17. Member portal: dashboard with membership status, digital card with QR code, profile management, event browsing and registration, regulations/terms
- R18. Digital membership card with unique card number, QR code linking to a public verification endpoint, validity dates, and auto-deactivation on expiry
- R19. PWA-installable: members can save the app to their home screen for instant card access
- R20. Public verification endpoint: anyone scanning a member's QR code sees a branded verification page confirming (or denying) card validity

**Admin and operations**

- R21. Admin panel with role-based access (configurable roles per organization) covering: member directory, application queue, originator management, event management, broadcast composition, tier management, scheduled job visibility, email template editing
- R22. Scheduled automation jobs (renewal reminders, expiry processing, payment reminders, committee escalation) run per-tenant with admin visibility into job status and the ability to toggle or manually trigger
- R23. Originator tracking: each originator has a unique invite link, referral counts are visible in admin, and the originator relationship is preserved on the member record for attribution and future commission models

**Compliance and data**

- R24. GDPR and Swiss DSG compliant by default: marketing consent tracking, opt-out handling via webhook (e.g., Postmark unsubscribe), data isolation per tenant, and consent audit trail (timestamp + IP)

---

## Acceptance Examples

- AE1. **Covers R9, R10.** Given a public visitor viewing the events page, when they see a members-only event, they see the event title and date but are prompted to apply for membership rather than seeing pricing or registration. When they see a public event, they see non-member pricing and can register and pay.

- AE2. **Covers R5, R15.** Given a comms agent drafting a broadcast via the API, when it sends a POST to the broadcast draft endpoint, the broadcast is saved with status "draft" regardless of any status field in the payload. The club manager sees the draft in the admin panel and must explicitly send it.

- AE3. **Covers R4.** Given a club founder setting up a new tier priced at EUR 350, when a member is approved and proceeds to payment, the platform creates a Stripe Checkout Session using the EUR 350 price directly — no Stripe Product or Price object needs to exist beforehand.

- AE4. **Covers R6.** Given an active member whose membership expires in 30 days, the system sends a first renewal reminder. If no action is taken, a second reminder follows at 14 days, and a third at 7 days. On the expiry date, the membership status transitions to expired, the digital card is deactivated, and the member receives an expiry notification.

- AE5. **Covers R2.** Given a club manager configuring their organization's branding, when they set a primary color, logo, and organization name, those appear on the member portal, public events page, digital membership card, and transactional emails — without any code changes or developer involvement.

---

## Success Criteria

- A club founder with no technical background can configure their organization (branding, tiers, first event, first originator invite link) and have a working membership pipeline within one session
- A club manager's recurring operational tasks (renewal chasing, expiry processing, event promotion, member communications) are automated or reduced to review-and-approve actions
- The platform can onboard a second organization (not GPC) without any code changes — only configuration
- The agent API surface is sufficient for an external AI comms agent to draft broadcasts, create/edit events, and preview audiences without needing direct database access
- A club that adopts the platform replaces at minimum 2-3 separate tools (spreadsheet/CRM, email tool, event platform) with one system

---

## Scope Boundaries

### Deferred for later

- Corporate sub-member accounts (corporate tier where a company has multiple named members under one membership)
- Apple Wallet / Google Wallet pass generation for the digital card
- Built-in CRM sync (Attio, HubSpot, etc.)
- Member directory visible to other members
- Guest invitation management and tracking per season
- Multi-language support (Weglot or built-in i18n)
- Reporting and analytics dashboard beyond job status visibility
- Customization credits packaging and commercial terms (pricing model principle is established; exact packaging is a commercial decision)

### Outside this product's identity

- POS, tee sheets, F&B management, reservation/booking systems (enterprise country club features — this is not that product)
- Content gating or course/content delivery (Memberful/Memberstack territory)
- Agency/consultant white-label reseller program (not a target buyer)
- The comms agent product itself (separate product with its own requirements; this platform provides the API it consumes)
- Social media publishing, scheduling, or management (the agent handles this; the platform does not)

---

## Key Decisions

- **Two go-to-market hooks, one product:** The platform is sold with two narrative entry points — operations-led (for managers drowning in admin) and agent-led (for founders who need professional comms fast). Both converge on the same product and pricing.
- **Agent is premium tier, not separate product:** The comms agent is positioned as the premium differentiator in the pricing structure (higher tier includes agent access), not a separately purchased product. The agent connects via the platform's API.
- **Dynamic Stripe integration:** No pre-created Stripe Products/Prices per organization. Checkout sessions are generated dynamically from the tier's price field. This is essential for self-service onboarding — a new club shouldn't need to touch the Stripe dashboard.
- **Draft-only agent constraint:** The agent API can create drafts but cannot send broadcasts or publish events. Human approval is always required. This is a trust and safety decision, not a technical limitation.
- **European market first:** Initial focus on Switzerland/DACH and broader European market, with GDPR/Swiss DSG compliance as baseline. The underserved European private club segment is the beachhead.
- **Customization credits model:** Platform subscription covers the core product. Higher tiers or add-on packages include a defined number of feature/customization requests per period. Requests are scoped by complexity bands to prevent scope creep. Exact packaging deferred to commercial planning.

---

## Dependencies / Assumptions

- The GPC codebase serves as the reference implementation and proves the feature set works in production. The SaaS product will be a new codebase that draws on GPC's patterns, not a fork.
- Stripe Connect or equivalent is needed for multi-tenant payment processing (each org collects its own payments). Approach deferred to planning.
- Email sending infrastructure needs a multi-tenant strategy (per-org sending domains, or a shared domain with per-org reply-to). Approach deferred to planning.
- The comms agent's brand identity, voice, and visual guidelines are stored and managed outside the membership platform (in the agent product). The platform API does not need to serve brand guidelines — only operational data.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R1, R2][User decision] Should the new project start as a fresh codebase that reimplements from GPC patterns, or as a fork of the GPC repo that gets progressively generalized? This affects project setup, timeline, and technical debt tradeoffs.

### Deferred to Planning

- [Affects R1][Technical] Multi-tenancy architecture: schema-per-tenant, row-level security, or separate databases? Depends on scale expectations and Supabase constraints.
- [Affects R4][Needs research] Stripe Connect account structure for multi-tenant payment collection — Standard vs Express vs Custom connected accounts.
- [Affects R13][Needs research] Multi-tenant email infrastructure: shared sending domain with per-org reply-to, or per-org verified domains via Postmark or alternative provider.
- [Affects R2][Technical] Theming system: CSS custom properties per tenant, stored config, or a theme builder UI. Depth of customization vs implementation cost.
- [Affects R22][Technical] Per-tenant cron job scheduling: shared scheduler with tenant-scoped execution vs isolated job queues.
