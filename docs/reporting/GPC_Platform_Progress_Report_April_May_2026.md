# Geneva Polo Social Club — What We've Built

**Period:** April -- May 2026
**For:** Thierry & the Geneva Polo Club team

---

## The Big Picture

Six weeks ago, the club's membership platform handled one thing: getting a new member from application to approved. Everything else — events, renewals, communications, tracking who's expired, chasing payments — was still manual.

Today, the platform runs the club's day-to-day operations end to end. From the moment someone receives an invite link to the day their membership expires and they're nudged to come back, the system handles it. Events are listed, tickets are sold, attendees are tracked, and branded communications go out to the right people — all from one place.

Here's what changed and why it matters.

---

## 1. Events Are Now Managed In-House

**Before:** Event promotion happened over email and WhatsApp. RSVPs were informal. There was no central attendee list, no way to collect payment online, and door staff had no reliable check-in tool.

**Now:** The platform is the single source of truth for all club events.

- **Public event pages** — every event has a shareable, branded page that anyone can view. Non-members see the public price; members see their discounted rate. This doubles as marketing: a visitor browsing events sees the membership value immediately.
- **Online ticket sales** — members and guests register and pay directly through the site. No manual invoicing, no chasing bank transfers.
- **Member-only pricing** — the system automatically shows the correct price based on whether someone is a member. No honour system, no manual checks.
- **Attendee list with check-in** — for every event, there's a live attendee list. Door staff can check people in on their phone. The list exports to CSV for print if needed.
- **Event types and filtering** — events are categorised (Polo, Social, Sport, Lifestyle) so members can browse what interests them.
- **Dedicated event coordinator access** — you can give someone (e.g., an event manager) access to manage events without giving them full admin access to the membership database.

**Time saved:** What used to require a spreadsheet, manual emails, and day-of coordination is now a single workflow. Creating an event, opening registration, collecting payment, and having a door list ready takes minutes instead of hours.

---

## 2. The Club Has Its Own Communication Channel

**Before:** Member communications went through Mailchimp or personal email. List management was manual — export members, import to Mailchimp, hope the list is current, send. No personalisation, no targeting by tier.

**Now:** The admin panel has a full broadcast composer with rich text editing, built into the platform.

- **Targeted messaging** — send to all members, or just specific tiers (e.g., only Gold and Platinum). The audience is always current — no stale export lists.
- **Personalisation** — messages automatically include the member's name, tier, and email. "Dear {{first_name}}" actually works, every time.
- **Draft and review** — compose a message, save it as a draft, review it, then send when ready. No accidental sends.
- **Unsubscribe compliance** — members can opt out, and the system respects their preference automatically. No manual list cleanup.

**Time saved:** A targeted, personalised broadcast to a specific segment of the membership now takes 5 minutes instead of 30–45 minutes of list management plus composition in a separate tool.

---

## 3. Memberships Renew Themselves

**Before:** When a membership approached its expiry date, someone had to manually check who was expiring, send individual emails, follow up, process payments, and update the spreadsheet. When someone expired, there was no systematic way to re-engage them.

**Now:** The entire renewal cycle is automated.

- **Reminder emails at 30, 14, and 7 days** — members get professionally branded reminders as their expiry approaches. The timing is adjustable from the admin panel.
- **Automatic expiry** — on the expiry date, the membership status updates, the digital card deactivates, and the member is notified. No manual status changes.
- **Self-service renewal** — expired members see a "Renew Membership" button in their portal. They choose their tier, pay online, and are reactivated instantly.
- **Re-engagement outreach** — for members who let their membership lapse, the admin can send reactivation emails (individually or in bulk) with a direct link back to the renewal page.

**Time saved:** Renewal season used to consume days of administrative work per cycle. Now it runs in the background. The admin's role shifts from chasing payments to reviewing the dashboard.

---

## 4. Honorary & Complimentary Memberships Are Effortless

**Before:** Inviting a VIP, sponsor, or partner as a complimentary member required a workaround — creating an application, manually overriding payment, manually activating the account.

**Now:** There's a dedicated flow for honorary members.

- **Honorary invite codes** — each originator can have a special code for complimentary invitations. The invitee sees only the free tiers.
- **No payment required** — free-tier applications skip the payment step entirely. On approval, the member is activated immediately with a full digital card.
- **"Renew as Honorary"** — when an honorary member's term expires, they can renew without payment in one click.

**Time saved:** What was a multi-step manual process is now as simple as sharing a link. The VIP applies, the committee approves, and they're in.

---

## 5. The Application Pipeline Is Transparent

**Before:** It was hard to see at a glance how many applications were pending, who had been approved but not yet paid, or who started an application but never finished.

**Now:** The applications page gives full visibility into the pipeline.

- **Tab-based view** — Pending, Approved, and Incomplete applications are clearly separated with count badges.
- **Incomplete application recovery** — if someone starts an application but doesn't finish, the system tracks it. The admin can send a reminder email with a direct link to resume where they left off.
- **Approver attribution** — every approval shows who approved it and when, creating an audit trail for the committee.
- **"Awaiting Payment" badge** — members who have been approved but haven't yet completed payment are clearly flagged, so nothing falls through the cracks.

---

## 6. Originator Tracking & Referral Attribution

Every member who joins can be traced back to the originator who invited them. This isn't just record-keeping — it's the foundation for understanding where growth comes from.

- **Each originator has a unique invite link** with their code embedded.
- **Referral counts are visible in the admin panel** — who's bringing in the most members, at a glance.
- **The relationship is permanent** — even as members renew year after year, the original referrer is always recorded.
- **Ready for commissions** — the payment infrastructure is structured so that when the club wants to introduce originator commissions, the data is already there.

---

## 7. AI-Ready: The Platform Can Be Managed by an Agent

This is forward-looking, but already operational. The platform exposes a dedicated set of endpoints that allow an AI assistant to:

- **Create and edit events** — draft an event, set details, and save it for admin review.
- **Draft broadcasts** — compose a member communication and save it as a draft for the admin to approve and send.
- **Preview audiences** — check how many members would receive a broadcast before it's sent.
- **Look up members, tiers, and originators** — pull reference data for context.

The key principle: the AI can draft, but only a human can publish or send. This means the club could eventually have an AI assistant handling routine content creation — event announcements, renewal nudges, seasonal newsletters — with the club manager simply reviewing and approving.

---

## 8. Payments Are Secure and Automated

- **Card authorisation on application** — when someone applies, a hold is placed on their card. Funds are only captured after the committee approves. If they're declined, no charge.
- **Payment retry** — if a card fails, the applicant gets an email with a secure link to try again, without starting over.
- **Event payments** — ticket purchases for events go through the same secure payment flow.
- **All payments tracked** — every transaction is recorded with amount, date, and status, building a complete financial history per member.

---

## 9. Real-Time Visibility Into What's Happening

- **Analytics** — the platform tracks how members use the site: which events get the most views, where people drop off, what pages get visited most.
- **Error monitoring** — when something goes wrong (a payment fails, a page doesn't load), the team is notified immediately rather than waiting for a member to complain.
- **Scheduled jobs dashboard** — the admin can see all automated tasks (expiry processing, renewal reminders, payment follow-ups) and their status, with the ability to trigger any of them manually.

---

## 10. Brand & Identity

The platform reflects the Geneva Polo Social Club's identity at every touchpoint:

- **Club name updated across all templates** — consistent "Geneva Polo Social Club" branding everywhere.
- **Professional email sender** — all communications come from social@genevapolo.com, not a generic no-reply address.
- **Custom favicon and branded pages** — the club crest appears in browser tabs and bookmarks.
- **OTP login** — members sign in with a simple 6-digit code sent to their email, rather than clicking a link that may get lost in spam.
- **International phone support** — the application form includes a country code selector for the club's international membership base.

---

## What This Replaces

| What used to happen | What happens now |
|---|---|
| Renewals tracked in a spreadsheet, manually emailed | Automatic 3-stage reminders, self-service renewal, auto-expiry |
| Event RSVPs via email/WhatsApp, manual attendee lists | Online registration, payment collection, live check-in list |
| Member communications via Mailchimp with CSV exports | Built-in broadcast composer with live audience targeting |
| Honorary invitations handled as manual overrides | Dedicated invite flow with one-click approval |
| No visibility into incomplete or stalled applications | Pipeline dashboard with tabs, badges, and reminder tools |
| Payment follow-ups done manually after approval | Automatic card hold on apply, capture on approval, retry on failure |
| No way to re-engage expired members systematically | Bulk reactivation emails with self-service renewal links |
| Event coordination across multiple tools | Single admin panel for creation, pricing, registration, and check-in |

---

## What's Coming Next

- **Corporate memberships** — for partners like Cardis and Sotheby's, where one company holds a membership with multiple named sub-members, each with their own card and portal access.
- **Event reminder emails** — automated notifications to registrants before their event.
- **Partner benefits** — a section for member perks and partner offers.
- **Originator commissions** — financial tracking so referrers can be compensated.

---

## By the Numbers

| Metric | Value |
|---|---|
| Active members | 98 |
| Total members on file (incl. pending, expired, honorary) | 123 |
| Applications processed since April | 56 |
| Events created | 21 |
| Event registrations | 164 (10 paid, 147 comp, 7 pending) |
| Broadcasts sent | 2 (reaching 23 recipients) |
| Automated emails sent (reminders, confirmations, etc.) | ~275* |

\* *Approximate. Transactional emails (registration confirmations, approvals, OTP sign-ins, renewal links, broadcast deliveries) are sent via Postmark and aren't aggregated in a single platform metric. The figure above is a lower-bound estimate from event registrations, broadcast recipients, application milestones, and renewal tokens issued. The exact count is available from the Postmark dashboard.*

What we can confirm from the development side:

| Development metric | Value |
|---|---|
| Features shipped since 1 April | 61 |
| Production updates deployed | 116 |
| Admin pages built | 17 |
| Automated workflows running daily | 4 (expiry, renewal reminders, payment reminders, committee notifications) |
| API endpoints powering the platform | 51 |

---

*Prepared May 2026*
