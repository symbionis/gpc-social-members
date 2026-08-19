# Delivery Roadmap

Prepared for the Coast engagement (OTM SARL and Geneva Polo Club).
Date: 18 August 2026
Status: working draft

---

## Revision note — 18 August 2026

This revision adds two roadmap items, extends item 6 to cover future flows as well as
existing ones, and corrects three claims that no longer hold. Delete this section before
the document goes to Coast.

**Added**

- Item 8, corporate memberships, reframed as a sales and marketing effort — with the platform
  work that supports the selling (signup route, benefits, lead targeting, pipeline view, funnel
  measurement) placed before a first deal, and the account machinery after it.
- Item 9 reframed: phone as identity, portal login and the WhatsApp channel, not only a data
  field. Login (FEAT-42) moved fully into item 9 — it is portal access, not comms — and out
  of item 5, which kept only the WhatsApp broadcast build it actually owns.
- Item 6, points 7 and 8: the write-path contract and the identity rule.
- Item 4, point 7: guest-to-member conversion is not currently measurable.
- Item 1 refocused on reconciliation, covering top-ups, extra tickets, the per-event ledger
  (already planned, not yet built), and a top-spender leaderboard.
- Item 4 refocused on defining and executing the funnel; the Shell Buyer comparison and
  waitlist-to-paid conversion dropped.
- Item 12, member portal engagement, mapped to the strategy's Member Portal Value track. The
  portal's one current engagement surface links out to the WhatsApp group item 5 wants to
  retire.
- Item 10, contacts and systems architecture. Precedes items 3, 5 and 6.
- Foundation work: the Railway/Redis row replaced. FEAT-22 and FEAT-21 are both Treasury
  tickets and both now shipped, so neither belonged in a GPC roadmap. What is GPC's own is
  the dedicated Railway project and its handover to the club.
- Item 11, orchestration into introductions, promoted out of the contract-gap section.
- Item 3 restructured: discovery channels and ticketing channels are different depths of work.
- Item 5 reframed as comms strategy, with an audit of what is automated today.
- Already delivered: rewritten and grouped by area. The previous nine-line list materially
  understated the platform in place; this matters, because that section is the value story.

**Corrected — each needs your confirmation before it is stated to the client**

1. **Member phone data is not sparse.** 132 of 165 members hold a number, 124 of them
   already well-formed. The dependency stands, but it is a build task, not a member-relations
   campaign, and the sequencing changes accordingly.
2. **FEAT-48 has grown, not held.** Re-run on 18 August 2026: 28 vulnerabilities against the
   24 recorded, and 16 high against 10. Eight reach the production runtime and every one of
   them has a non-breaking fix. Left alone, this row gets worse on its own.
3. **COPA SAN MARTÍN is the major event of the year, and its ticketing runs outside the
   portal.** The roadmap previously assumed portal traffic throughout. Items 4 and 6 now
   carry the consequence.

---

## Purpose

This document details the twelve roadmap items, what each contains, and where each stands against the Product Features database in Notion.

It is a working plan. It is not a milestone schedule and does not set fixed dates or acceptance conditions. Acceptance runs through the monthly report under Clause 2.3 of the Services Agreement.

---

## 1. Event finance reconciliation

Every franc that moves is traceable to the row that caused it, and every row that claims money
names the charge that carried it. Per-event P&L is downstream of that and worth little without it.

### Contains

1. **Charge attribution.** Every row that moved money records the Stripe object that moved it:
   registrations, top-ups, ticket-type upgrades, refunds. This is the foundation; the rest is
   reporting.
2. **Extra tickets and top-ups.** The guest-initiated top-up path charges, mints and records
   the charge in one flow. The admin path does not: raising the ticket count on a paid event
   moves the seats but not the money, so added seats are silently comped. Close that gap, and
   bring both paths onto the same record so a seat added either way is reconcilable.
3. **Refund reconciliation.** Refunds are issued from the admin roster with no Stripe webhook
   confirming them, by choice, so a refund that fails or is later reversed at Stripe leaves the
   dashboard reporting a number that never happened. Reconcile issued against settled, and
   surface cancellations that freed a seat but never returned the money.
4. **Two-way settlement check.** Every Stripe charge maps to a row, and every paying row maps
   to a charge. One direction catches money the club received and cannot attribute; the other
   catches revenue the dashboard reports that Stripe never collected.
5. **Comps and manual adjustments recorded as such**, so a hand-made booking is distinguishable
   from a purchase that lost its charge. Today they look identical.
6. **Externally ticketed events.** Money collected on Luma, Weezevent or COPA SAN MARTÍN's
   provider reconciled into the same per-event picture, per item 3. Per-event revenue that
   covers only portal sales is not per-event revenue.
7. **Per-event ledger.** A transaction-level breakdown beneath every event: each booking, and
   within it the original checkout, each applied top-up, each priced upgrade, and each refund.
   The Events tab is the only one of the finance dashboard's three tabs with no drill-down —
   Membership opens to its payments, Originator to its transactions, Events to nothing. The
   rows are already computed and handed to the CSV export, so an admin can download detail the
   dashboard refuses to display. Planned in full at
   `docs/plans/2026-08-12-001-feat-admin-bookings-ledger-plan.md`; implementation-ready, no
   migration needed.
8. **Top-spender leaderboard.** Contacts ranked by what they have actually spent — event
   tickets and membership combined — per season and lifetime. Answers who to invite, who to
   approach about corporate membership (item 8), who to introduce (item 11), and who the club
   would most miss if they lapsed. A rough version is computable from today's data: the
   leading contact has spent CHF 2,960 across two bookings and a membership.
   Three things it forces into the open before the number can be trusted:
   - **Identity.** Keyed on email today, so one person using two addresses splits in two and a
     couple sharing a mailbox merges into one. Item 6's identity rule is the fix.
   - **Attribution.** A lead who books a table of twelve shows as the spender. That is correct
     for revenue and wrong for engagement; the two need separating, or the choice stating.
   - **Refunds** netted out, per point 3, or the board ranks money that came back.
   Both revenue streams are in francs, so they add up cleanly — but membership amounts sit in a
   column named `amount_eur` that has always held CHF. Harmless to the app, which knows;
   a trap for anyone reading the data directly or wiring up a report. Worth renaming.
9. **Per-event P&L and committee reporting**, per event and per season — once 1 to 8 make the
   underlying numbers trustworthy.
10. Stripe manual capture and deposit handling.

**Notion**: partial. FEAT-34 covers the charge/refund delta only, sitting at P2 Backlog. The
attribution gap and the wider reconciliation plan have no record.

**Note**: items 7 and 8 open the same payment path — discount codes change what is owed,
corporate billing changes who owes it. Build the three together rather than opening the Stripe
flow three times. Item 3's ticketing channels add a fourth source of money to reconcile.

---

## 2. Media management platform

An image and video asset library for the club. Self-hosted on Immich.

**Contains**

1. Central library for photography and match footage, replacing assets living on personal phones.
2. Background backup from committee and photographer phones, so footage lands on the server without anyone remembering to upload.
3. Tagging, albums, and CLIP-based search.
4. Face recognition, for finding a member across a season.
5. Per-event albums.
6. A durable club archive that survives committee turnover.

**Notion**: no record.

**Platform decision**: Immich. AGPL-3.0, photo and video, backed by FUTO. Native iOS and Android apps with background backup. Docker Compose install, 6GB RAM recommended minimum, more once machine learning is running.

### What Immich does not do

Immich is a photo manager, not a digital asset management system. Three things are out of scope and need a decision:

1. **Rights and usage tracking.** Who shot it, what it may be used for, whether the subject consented. The club publishes photographs of identifiable members, sponsors, and children. This is a governance question, not a feature preference.
2. **Approval flow before publication.**
3. **Structured metadata schemas** beyond tags and albums.

Options: accept the gap and handle consent through club process rather than software; add a lightweight consent field through Immich's API; or pair Immich with a DAM layer such as ResourceSpace for the curated, rights-cleared subset that actually gets published.

### AGPL and Clause 5.1

Immich is AGPL-3.0. Modifications served over a network must be published under the same licence, with a notice pointing to the source.

Deploying Immich unmodified is fine. Building custom integration into the Immich codebase is not, at least not while retaining ownership under Clause 5.1. Integration should sit outside Immich and talk to it over the API.

### Running costs

Server, storage, and the machine learning container. Video is the driver. Under Clause 2.5 these sit with the client, so the figure needs naming before deployment rather than after the first invoice.

---

## 3. Event distribution and external ticketing

One canonical event record, published out to channels that list it and to channels that sell it.

### Discovery channels

Listing only. The channel advertises, the portal sells.

1. Channel adapters running off a single publish action.
2. Targets: Eventfrog, Genève Tourisme, Facebook Page, LinkedIn Page.
3. EN translations of event copy, required for Genève Tourisme propagation.
4. Listings link back to the portal. Ticketing stays here, so the club keeps the member data
   and the payment relationship.

### Ticketing channels

Channels that sell seats: Luma, Weezevent, and the provider handling COPA SAN MARTÍN. An
order of magnitude deeper than a listing adapter, and it should be estimated as such.

5. Attendee ingestion from each channel into the platform.
6. **Credential issuance for externally sold tickets.** An attendee who bought on Luma is
   issued a platform QR credential ahead of the event, so the existing door, roster and
   access control work unchanged. Without this a Luma buyer arrives with a ticket the door
   cannot read.
7. Waiver capture for those attendees, on the same terms as a portal buyer.
8. Reconciliation of externally collected money into item 1, so per-event revenue is whole
   rather than portal-only.
9. Consolidation of every attendee list into the contact system, per item 6.

**Notion**: FEAT-49, Specced, P2 — covers the discovery half only. The ticketing half has no record.

**Client-side inputs**: Eventfrog organiser account and API key. Facebook and LinkedIn Page
admin access. Luma and Weezevent organiser accounts and API access.

**Depends on** item 10 for the record-ownership and credential decisions.

---

## 4. Conversion optimisation

Defining the registration funnel, then executing against what it shows.

**Contains**

1. **Define and instrument the funnel.** PostHog is already on the portal — pageviews,
   identify on login, error capture — but nothing captured today marks a step in the
   registration path. Every custom event in the codebase is either an admin action or a
   failure case; there is no `event_view`, `registration_started`, `payment_succeeded` or
   `confirmation_viewed`. Define the steps, add the events, and get a funnel that shows where
   guests drop off.
2. Checkout friction removal, driven by what the funnel shows.
3. Event page testing: copy, imagery, pricing presentation.
4. Channel attribution, so distribution effort can be judged rather than assumed.
5. Guest-to-member conversion, measured. The rate is the club's stated scoreboard and nothing computes it today. Establishing it requires a stable identity for the guest, which is item 6.

**Notion**: no record for the portal.

**Sequencing**: instrument before item 3 goes live. Distribution without attribution produces traffic nobody can evaluate.

**Baseline, 18 August 2026**: across all event data, three people appear as guests before their membership record exists. Thirty others appear at events they attended as members already. Whatever the true conversion rate is, the reporting cannot currently distinguish the two, and the number reached here took hand-written SQL across four tables.

**External ticketing**: COPA SAN MARTÍN, the largest event of the year, is ticketed outside the portal. Its attendees will not appear in any portal funnel. Attribution for the year's biggest audience depends on the import path described in item 6, not on instrumentation.

---

## 5. Comms strategy

What the club sends, to whom, and which of it should run without anyone remembering. A
strategy exercise first, a build second.

### What is automated today

| Automation | Cadence |
|---|---|
| Event reminders | Hourly |
| Renewal reminders | Daily |
| Payment reminders | Daily |
| Committee reminders | Daily |
| Membership expiry | Daily |
| Transactional email: tickets, receipts, confirmations, waitlist offers, household tickets, cancellations | On event |
| Broadcasts: drafts, audience preview, send | Manual |

### The gap

**There is no post-event follow-up.** Nothing fires after a guest attends. This is the single
step the club's own strategy calls the heart of its approach — the crowd is captured at the
door and then nothing reaches them. Every other lifecycle moment in the platform is
automated; this one, the one that converts, is not.

### Contains

1. Comms strategy: what is sent, to which segment, on what trigger, and what is deliberately
   not sent.
2. **Post-event follow-up automation**, against checked-in non-members.
3. Segmented email against the contact list from item 6.
4. WhatsApp broadcast to members, one to many, members cannot post into it. The number it
   sends to and the login members use to reach the portal are one job, not two — see item 9.
5. Review of the existing six automations for cadence, overlap and tone.

**Notion**: FEAT-43 (WhatsApp broadcast), P2 Backlog. Phone login is FEAT-42, tracked under
item 9 — it is portal access, not a comms deliverable, even though both ride the same number.
The strategy work and the follow-up automation have no record.

**Why it matters**: the existing community groups are full of bots and fake waiting-list
entries with no moderation. This replaces them with a channel members cannot pollute.

**Client-side inputs**: business WhatsApp account, dedicated club number or SIM, Meta
Business connection.

**Dependency: member phone numbers.** Previously recorded here as sparse and gating both
FEAT-42 and FEAT-43. Measured on 18 August 2026, the member dataset is not sparse: 132 of 165
members hold a number, 124 of those already well-formed. What is missing is normalisation of
the remaining handful and consolidation of numbers captured elsewhere — 288 ticket rows and
226 registration rows hold a number that never reached a member record. That is item 9, a
build task, not a member-relations campaign. The dependency stands; its size and shape do not.

---

## 6. Consolidate leads and contacts

The network system, built and populated, on Attio. Existing contacts and every future one.

**Contains**

1. Migration of existing contacts from every current location.
2. Deduplication and cleaning.
3. Segmentation: member, prospect, corporate, sponsor, press.
4. Capture points designed around how the club actually meets people, at events, on the field, through introductions.
5. Lifecycle stages.
6. Corporate and B2B event pipeline. Extends into item 8.
7. **Write-path contract.** Every capture point writes to the contact record as its primary act, not as a copy taken afterwards. Event registration, ticket claim, door check-in, waitlist entry, membership application, and externally ticketed events by import. A capture point that does not write to the contact system is a leak, and at present every one of them is.
8. **Identity rule.** An email address belongs to the buyer, not to the booking. A guest on
   someone else's booking is a contact in their own right, with no email until they give one.
   Deduplication therefore keys on identity and never on contact details alone. The real work
   is resolving one person who appears twice across sources — as a nameless attendee last
   season and a buyer this one — not merging at the point of capture.
9. **Consent state.** The CRM holds current consent per contact and per channel. The evidence
   — wording shown, version, timestamp — stays at the point of capture, where it was given.
   Every touch point carries correct consent wording and a working mechanism behind it.
10. Sources: the platform, MailChimp, external ticketing channels, and any other system
   holding club contacts. Enumerating those systems is a discovery task with a date on it;
   an unknown source found mid-migration is what breaks a migration.

**Notion**: no record. Attio appears only as a dependency line on FEAT-1.

**Contract**: this is the closest match in the whole roadmap to Clause 2.2(a), which reads "a network system (CRM) built and populated, with existing contacts migrated and capture designed around how OTM works."

**Sequencing**: follows item 10, which sets record ownership and the identity rule.
Prerequisite to item 5 — a broadcast against a dirty list is worse than no broadcast — and to
item 4 point 7, and to the corporate segmentation in item 8. Feeds item 11.

**Scale, 18 August 2026**: 633 distinct contacts appear across tickets, registrations and the waitlist. 590 of them are not members. They are held in four tables with no contact entity of any kind, and no table named for a lead, a contact or a person exists in the schema.

**Capture quality**: 129 of 542 live ticket rows carry no email address. Thirty-two of those people checked in at a door. They were captured physically and cannot be reached by anything item 5 builds. Point 7 exists to stop this recurring; the migration in point 1 will not recover them.

**External ticketing**: COPA SAN MARTÍN sells through a separate system. Its attendees do reach the contact records today, but by hand — roughly an hour of someone's time per event, plus the transcription errors any retyped list carries. An automated import returns that hour and makes the year's largest gathering of prospects arrive clean. The import belongs in this item, not in item 3.

---

## 7. Discount codes

**Contains**

1. Code generation and management.
2. Percentage and fixed-amount discounts.
3. Member-tier codes and sponsor codes.
4. Usage caps, expiry dates, per-event restriction.
5. Redemption reporting, feeding back into item 1.

**Notion**: no record.

**Client-side input**: discount policy. Who qualifies, what depth, whether codes stack.

---

## 8. Corporate membership growth

Driving more corporate memberships. This is a sales and marketing effort, run by a sales
strategy function against a target account list — not a build. It belongs on this roadmap
because it creates platform work downstream, and because the prospect list it needs already
exists inside the data this roadmap is consolidating.

### The effort

1. Target account list and pitch, owned by sales, not engineering.
2. Outreach and the pricing conversation.
3. Corporate hospitality sold against event inventory as part of the pitch, once item 1 makes
   event revenue and capacity trustworthy enough to sell against.

### Platform work that supports the sale — before a deal, not after

The selling is not unsupported. These exist to make the effort land, and they are the reason
this item is not purely a sales line on a delivery roadmap.

4. **A corporate enquiry and signup route**, distinct from the individual application. Today a
   company interested in membership has nowhere to land but a form built for one person.
5. **Corporate benefits presented properly** — what a corporate membership actually includes,
   browsable rather than described in a paragraph. Shares the benefits surface with item 12.
6. **Lead targeting.** Prioritising the account list out of the contact data rather than by
   hand: which companies are already represented, by how many members, at what seniority.
   Depends on item 6's segmentation.
7. **Sales support.** Whoever runs the effort needs to see the pipeline — who has been
   approached, what stage each account is at, what was agreed. Not a CRM rebuild; the corporate
   view of the one item 6 builds.
8. **Funnel measurement for the corporate path** — enquiry, conversation, agreement — so the
   effort can be judged and improved rather than repeated blind. Item 4's discipline applied to
   a second funnel.

**Not greenfield**: 87 of the 165 current members already carry a company name and 77 a
company role. That is not evidence the *build* is easy — it is a starting prospect list.
Companies already represented in the membership are the first accounts to approach, surfaced
by item 6's corporate segmentation rather than assembled by hand. The sub-member model was
scoped previously against Cardis and Sotheby's as the first two cases and is a live example of
what a pitch can point to.

**This is what item 11 is for.** Orchestration into introductions is the mechanism that turns
a target account list into an actual conversation. Corporate growth is a specific instance of
that job, not a separate motion running alongside it.

### What follows a first agreement

Deliberately held until a deal exists, so the account machinery follows demand rather than
anticipating it.

9. Corporate account entity, with seats allocated to named sub-members.
10. Billing at account level, and seat changes within the term.
11. Sub-member lifecycle independent of the account: joiners, leavers, replacements mid-term.

**Notion**: no record.

**Depends on** item 6 for the target list, segmentation and the pipeline view; item 4 for the
corporate funnel measurement; item 11 for the introductions motion; item 12 for the benefits
surface; item 1 for account-level billing once the account machinery starts. Shares the payment
path with items 1 and 7.

**Client-side input**: who owns the sales effort — a dedicated sales/growth function or
existing committee capacity — and the seat policy the build needs once a deal is close: seats
per tier, price per seat, who may reassign one, what happens to a sub-member when the account
lapses.

---

## 9. Phone: identity, login, and the WhatsApp channel

Not only a data-quality field. A single well-formed number per person is what member portal
login, WhatsApp broadcast, and every door and registration capture point all sit on top of —
the same number serving three different jobs, so it only needs fixing once.

**Contains**

Data quality — the foundation the other two stand on:

1. E.164 normalisation and validation at every point a number is entered.
2. Capture at every surface: registration, ticket claim, door, membership application.
3. Consolidation onto the contact record, so a number given at a door reaches the person's
   record rather than sitting on a ticket row.
4. Phone as a secondary identity signal for deduplication in item 6, never as a sole key.

Login — phone as a way into the portal, not just a way to be reached:

5. Phone-based member portal login (FEAT-42), alongside or instead of email.

Comms — the channel item 5 needs this to send to:

6. WhatsApp broadcast (FEAT-43), which needs a verified, well-formed number per recipient.
   The broadcast build itself belongs to item 5; this is what makes it possible to send.

**Notion**: no record of its own for the data-quality half. FEAT-42 and FEAT-43 both P2
Backlog.

**Current state, 18 August 2026**: members 132 of 165, of which 124 are already well-formed and 8 are not. Tickets 288 of 542. Registrations 226 of 594. The member dataset is in good shape; the platform-wide picture is not, and the numbers held on tickets and registrations are stranded where no member record can see them.

**Already part-built**: the Sinch phone-OTP edge function is deployed and dormant, pending
owner secrets and enablement (PR #44, open) — this is the login mechanism, point 5, closer to
delivery than its backlog position suggests.

**Sequencing**: points 1 to 4 belong with item 6, since deduplication needs the normalised
field. Points 5 and 6 land alongside item 5 — though login does not need to wait for it: it
only needs the member-phone data points 1 to 4 already put in good shape, not the full
contact consolidation the broadcast list depends on. It could move earlier if wanted sooner.

---

## 10. Contacts and systems architecture

The written contract for how people move between systems. Small, and it unblocks items 3, 5 and 6.

**Contains**

1. **Record ownership, per fact rather than per system.** Attio owns the relationship: stage,
   segment, owner, notes. The platform owns attendance, payment and consent evidence — it is
   the only system with a door, a card and a payment record. A channel that stores addresses
   is not thereby a source of truth.
2. **Sync direction.** One way per field, from the owner outward. Two systems that both accept
   edits on the same field need conflict resolution and loop suppression, and fail by silent
   divergence rather than by error.
3. **Identity resolution.** One rule, implemented once, applied by every integration — not
   reinvented per channel.
4. **Consent basis, per source.** An address given on a portal registration, one imported from
   MailChimp, and one obtained from a ticketing channel do not carry the same permission to
   send. Merging them into one list flattens a distinction the club is accountable for: under
   Swiss nLPD and GDPR the association is the controller.
5. **Credential path for externally sold tickets**, feeding item 3.
6. **Named human owner per system.** Organisational rather than technical, and it is what keeps
   point 1 true six months later.

**Notion**: no record.

**Why first**: items 3, 5 and 6 each assume answers to these questions. Answered once, they
are cheap. Answered three times, differently, they are a data migration.

---

## 11. Orchestration into introductions

Clause 2.2(c): turning the network into introductions and opportunities. Distinct from
building the CRM — this is operating it.

**Contains**

1. Signals worth acting on: who attended what, who was introduced to whom, what has gone quiet.
2. Prompts to the right person at the right moment, rather than a report nobody opens.
3. Introduction tracking: made, accepted, what came of it.
4. Feeding the personal agent, which is where this becomes leverage rather than admin.

**Notion**: no record.

**Note**: bigger than lead management and should not sit inside item 6. Item 6 builds the
network; this is what the network is for.

---

## 12. Member portal engagement

The between-events reason to log in. This is the strategy's third track, Member Portal
Value, given a roadmap shape: conversion does not stick if there is nothing behind the door.

### Current state

The dashboard is largely passive: welcome, membership status, tier, the next four events, a
digital card, and a static lounge schedule of weekly open/closed hours with no booking. A
tier's `benefits` field is a block of marketing text shown once at signup or renewal, not a
browsable or redeemable directory.

**The one section aimed at ongoing engagement sends members off the platform.** "Community"
is a single link to the club's WhatsApp group — the same group item 5 already names as full
of bots and unmoderated fake waitlist entries, and the one the comms strategy proposes to
replace. As it stands, the portal's own answer to "why come back" is a doorway out of the
portal into the channel the rest of this roadmap is trying to retire.

### Contains

1. **Partner benefits, made real.** A browsable, member-only directory replacing the static
   text block — what a membership is worth, not a paragraph describing it.
2. **A destination to replace the WhatsApp link.** Something in-app worth opening between
   events, so the portal's own engagement surface stops pointing away from itself.
3. **Event recaps and photo highlights**, drawing on item 2's media library once it exists —
   the between-events reminder of what membership is for.
4. **Lounge booking**, turning the static schedule into an actual reservation.
5. **A member directory**, opt-in, giving members a reason to look at who else is in the
   club — and a data source for item 11's introductions.

**Notion**: no record.

**Depends on**: item 2 for recaps and photo content, item 6 for the member data a directory
and personalised content need, item 11 for introductions once a directory exists.

---

## Named in the contract, absent from the roadmap

### Private personal agent

Clause 2.2(b): "a private personal agent on a dedicated secure server, set up and tuned over time."

A named contractual deliverable. It appears nowhere in the roadmap and nowhere in Notion. It is also the most personally tangible thing Coast receives, and the one whose absence he will notice.

Server provisioning, agent deployment, tuning across the term, connection into the CRM and the lead pipeline. Running costs sit with the client under Clause 2.5.

This belongs alongside item 6 in the early months.

### Orchestration into introductions

Promoted to item 11.

### Coaching capacity

Clause 2.1: two sessions per month. CHF 500 monthly, CHF 6,000 across the year, roughly a third of the engagement.

Value is delivered by holding the reserved slot. Unused sessions convert to a written brief or recording, or roll into build work at the same value. Easy to under-count in the value story precisely because nothing gets built.

---

## Foundation work

Not on the roadmap. Not visible on screen. It is what stops a member-data incident landing on the association.

| Item | Notion | Priority |
|---|---|---|
| npm audit: **28 vulnerabilities, 1 critical, 16 high** — grown from the 24/10 recorded. 19 reach production (0 critical, 8 high), all with fixes available. The critical is dev-only, via the Supabase CLI | FEAT-48 | P1 — **worsening** |
| Dedicated Railway project for `gpc-social-members`, then handover of ownership and billing to the club | FEAT-50 | P2 |
| Error tracking and PostHog to agent pipeline | FEAT-25 | P1 |

---

## Already delivered

Value in place before the effective date, which the fee does not reflect and which continues
to accrue. Grouped by area. Verified against the codebase on 18 August 2026: 101 database
migrations, and around eighty API routes in production.

**Events and ticketing**
Event creation and management with multiple ticket types and per-rate pricing. Registration
with card payment. Waitlist, including paid offers out to waitlisted guests. Seat top-ups and
ticket-type upgrades on an existing booking. Cancellations. Guest lists and comp seats.
Invite codes and share links, member and admin.

**Door and access**
QR and NFC bracelet access control. Check-in console and live arrivals roster. Guest
self-service: naming a seat, household tickets, waiver capture at the point of entry.
Attendee export for hand-checked doors. Ticket resend at the door.

**Membership**
Application, review, approval and decline. Member portal: dashboard, profile, events,
digital card, regulations. Renewals, honorary renewal, reactivation of lapsed members.
Membership tiers. Originator and referral attribution. Public card verification.

**Money**
Stripe checkout for both events and membership. Payment retry links. Refunds issued from
the admin roster. Finance dashboard covering membership and per-event revenue, with refunds
netted out.

**Comms**
Transactional email throughout, on managed templates. Broadcasts with drafts, audience
preview and send. Per-event messaging. Automated reminders: event, renewal, payment and
committee.

**Admin and operations**
Admin console with role-based access. Scheduled jobs, with a UI to inspect and run them.
Email settings and template editing. Lounge sessions. Agent API for programmatic access.
Mobile responsive throughout.

**Platform**
Error tracking with source maps, continuous integration, and automated deployment.

---

## Suggested sequence

**Phase 0. Foundation.**
FEAT-48 first.

**Phase 1. Architecture.**
Item 10. A short written deliverable, not a build. Items 3, 5 and 6 all wait on it, and each
gets cheaper for having it.

**Phase 2. Revenue mechanics.**
Items 1 and 7 together. Same payment path. Item 8's platform tail joins here only once
sales has landed a first corporate deal — the build follows the sale, not the reverse.

**Phase 3. Network.**
Item 6, alongside the personal agent. Item 9 points 1 to 4 run inside this phase, not after
it: deduplication needs a normalised phone field, and retrofitting one across capture points
already rebuilt is the expensive order. The COPA SAN MARTÍN import belongs here too, ahead of
the event rather than after it.

**Phase 4. Audience.**
Item 5, once the list is clean. Post-event follow-up is the
first automation to build, being the one the strategy rests on. Item 9's WhatsApp broadcast
readiness (point 6) lands here, gating FEAT-43. Phone login (point 5) does not need to wait
for this phase and could ship as soon as Phase 3's member-phone cleanup is done.

**Phase 5. Reach.**
Instrument the portal. Then item 3, discovery half first, ticketing half once item 10 has
settled the credential path. Then item 4.

**Phase 6. Operating the network.**
Item 11. Needs item 6 populated and the personal agent running before it has anything to work
with.

**Phase 7. Media.**
Item 2. Loosest coupling, and the Mixpost half is gated on FEAT-22 regardless.

**Phase 8. Member portal engagement.**
Item 12. Its slowest dependency is item 2's media library, landing in the phase before. Two
points do not need to wait: the partner benefits directory and lounge booking touch neither
item 2 nor item 11, and could move earlier if the club wants portal value sooner than this
sequence delivers it.

---

## Open decisions

1. Media rights and consent: handle in club process, extend Immich through the API, or pair with a DAM layer.
2. Immich hosting: where it runs, and the storage budget for video.
3. Discount policy: who qualifies, what depth, stacking rules.
4. Phone consolidation: whether a number captured on a ticket may be written onto a member record without asking the person, and what the club tells them at the point of capture.
5. Personal agent: server, model, scope of access.
6. Whether OTM and the GPC Association consolidate into a single counterparty.
7. Who owns corporate membership growth: a dedicated sales/growth function, or existing
   committee capacity running it alongside everything else.
8. Corporate seat policy: seats per tier, price per seat, who may reassign, and what happens
   to sub-members when an account lapses. Needed once the first deal is close, not before.
9. COPA SAN MARTÍN contact import: whether the external ticketing provider will release
   attendee data, in what form, and on what consent basis.
10. **MailChimp's future.** It stops being a source of truth either way. Whether it remains a
   sending tool is separate, and there are three options: (a) platform broadcasts become the
   channel and MailChimp retires — cleanest, one consent record, no sync; (b) MailChimp stays
   as sender, fed one way from the system of record, which means syncing unsubscribe and
   consent state back; (c) both persist, which is what happens if nobody decides. Against (a):
   MailChimp gives non-technical staff a visual campaign builder, A/B testing and
   deliverability reporting. Worth establishing who actually writes the newsletters before
   choosing.
11. Consent wording per touch point: who drafts it, who approves it, and whether it differs by
   channel.
