#!/usr/bin/env python3
"""Build the client-facing roadmap HTML, styled to match the Geneva Polo Club
Platform Progress Report house format."""
import base64, pathlib

REPO = pathlib.Path("/Users/dev/GPC_Social_Members")
OUT = REPO / "docs" / "reporting"


def b64(p):
    return base64.b64encode(pathlib.Path(p).read_bytes()).decode()


F = {
    "playfair": b64(REPO / "app/fonts/playfair-display-variable.woff2"),
    "pop300": b64(REPO / "app/fonts/poppins-300.woff2"),
    "pop400": b64(REPO / "app/fonts/poppins-400.woff2"),
    "pop500": b64(REPO / "app/fonts/poppins-500.woff2"),
    "pop600": b64(REPO / "app/fonts/poppins-600.woff2"),
}
LOGO = b64(REPO / "public/images/polo_club_logo.png")

CSS = """
@page { size: A4; margin: 24mm 26mm 18mm; }
.coverdoc @page { margin: 0; }

@font-face { font-family:'Playfair'; src:url(data:font/woff2;base64,%(playfair)s) format('woff2');
  font-weight:400 900; font-style:normal; font-display:block; }
@font-face { font-family:'Poppins'; src:url(data:font/woff2;base64,%(pop300)s) format('woff2'); font-weight:300; }
@font-face { font-family:'Poppins'; src:url(data:font/woff2;base64,%(pop400)s) format('woff2'); font-weight:400; }
@font-face { font-family:'Poppins'; src:url(data:font/woff2;base64,%(pop500)s) format('woff2'); font-weight:500; }
@font-face { font-family:'Poppins'; src:url(data:font/woff2;base64,%(pop600)s) format('woff2'); font-weight:600; }

:root{ --marine:#052938; --sky:#95CEE1; --skyd:#3C7C94; --red:#D42A1F;
       --ink:#213039; --muted:#5d7079; --tint:#EAF4F8; --rule:#dbe6ea; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{ font-family:'Poppins',sans-serif; font-weight:300; font-size:10pt; line-height:1.63;
      color:var(--ink); -webkit-font-smoothing:antialiased; }

/* section starts on a fresh page */
.page{ page-break-before:always; }
.page.first{ page-break-before:auto; }

/* ---------- cover ---------- */
.cover{ position:relative; z-index:5; background:var(--marine); color:#fff;
        height:297mm; padding:11mm 26mm 22mm; display:flex; flex-direction:column;
        page-break-after:always; margin:0; }
.cover .crule{ height:2px; background:var(--red); margin-bottom:38mm; }
.cover img{ width:30mm; opacity:.95; margin-bottom:26mm; }
.cover .kick{ font-size:9.4pt; font-weight:300; letter-spacing:.22em; text-transform:uppercase;
              color:var(--sky); margin-bottom:6mm; }
.cover h1{ font-family:'Playfair'; font-style:italic; font-weight:700; font-size:38pt;
           line-height:1.08; margin:0 0 7mm; letter-spacing:-.015em; }
.cover .urule{ width:52mm; height:2px; background:var(--sky); margin-bottom:8mm; }
.cover .kick2{ font-size:8.6pt; font-weight:400; letter-spacing:.18em; text-transform:uppercase;
               color:var(--sky); margin-bottom:2.5mm; }
.cover .date{ font-size:13pt; font-weight:400; color:#fff; }
.cover .prep{ margin-top:auto; font-size:9.4pt; font-weight:400; color:var(--sky); }

/* ---------- headings ---------- */
h2{ font-family:'Playfair'; font-style:italic; font-weight:700; font-size:19pt; color:var(--marine);
    margin:0 0 3mm; letter-spacing:-.01em; page-break-after:avoid; }
h3{ font-family:'Playfair'; font-style:italic; font-weight:700; font-size:14pt; color:var(--marine);
    margin:0 0 3mm; letter-spacing:-.005em; page-break-after:avoid; page-break-before:auto; }
.hr{ width:28mm; height:2px; background:var(--sky); margin:0 0 5mm; page-break-after:avoid; }
.hr.wide{ width:44mm; }

p{ margin:0 0 3.6mm; text-align:justify; }
.lede{ font-size:11pt; color:var(--muted); line-height:1.7; }
strong{ font-weight:500; color:var(--marine); }
em.fig{ font-family:'Playfair'; font-style:normal; font-weight:700; color:var(--marine); }

ul{ margin:0 0 4mm; padding:0; list-style:none; }
li{ position:relative; padding-left:7mm; margin-bottom:2.2mm; text-align:justify; }
li:before{ content:"•"; position:absolute; left:2mm; color:var(--skyd); }

/* ---------- blocks ---------- */
.item{ margin-bottom:8mm; }
.why{ background:var(--tint); padding:4mm 5mm; margin-top:3mm; page-break-inside:avoid; }
.why p{ margin:0; font-size:9.5pt; color:var(--marine); }
.why p+p{ margin-top:2.6mm; }
.why .lbl{ font-weight:600; }
.sep{ width:22mm; height:1px; background:var(--rule); margin:7mm 0; }

.pair{ page-break-inside:avoid; margin-bottom:4.5mm; }
.pair h4{ font-family:'Poppins'; font-weight:600; font-size:8.4pt; letter-spacing:.14em;
          text-transform:uppercase; color:var(--skyd); margin:0 0 1.6mm; }
.pair p{ margin:0; font-size:9.6pt; }

.phase{ page-break-inside:avoid; margin-bottom:4.4mm; padding-left:24mm; position:relative; }
.phase .tag{ position:absolute; left:0; top:.6mm; font-size:7.8pt; font-weight:600;
             letter-spacing:.14em; text-transform:uppercase; color:var(--skyd); }
.phase p{ margin:0; }

.dec{ page-break-inside:avoid; margin-bottom:4mm; padding-left:8mm; position:relative; }
.dec .n{ position:absolute; left:0; top:0; font-family:'Playfair'; font-style:italic;
         font-weight:700; font-size:11pt; color:var(--skyd); }
.dec p{ margin:0; }

h4.sub2{ font-family:'Poppins'; font-weight:600; font-size:7.8pt; letter-spacing:.15em;
         text-transform:uppercase; color:var(--skyd); margin:4mm 0 2mm; page-break-after:avoid; }
p.dep{ font-size:8.8pt; color:var(--muted); margin:3mm 0 0; text-align:left; }
p.dep strong{ color:var(--skyd); font-weight:600; }
.item ul{ margin:0 0 1mm; }
.item li{ font-size:9.5pt; margin-bottom:2.4mm; }

.toc{ margin:1mm 0 0; }
.toc div{ display:flex; gap:5mm; padding:1.7mm 0; border-bottom:1px solid var(--rule);
          font-size:9.6pt; page-break-inside:avoid; }
.toc div:last-child{ border-bottom:none; }
.toc .n{ font-family:'Playfair'; font-style:italic; font-weight:700; color:var(--skyd);
         width:6mm; flex:none; }
""" % F

COVER = """
<div class="cover">
  <div class="crule"></div>
  <img src="data:image/png;base64,__LOGO__" alt="">
  <div class="kick">Geneva Polo Social Club</div>
  <h1>Where We Go<br>From Here</h1>
  <div class="urule"></div>
  <div class="kick2">Delivery Roadmap</div>
  <div class="date">August 2026</div>
  <div class="prep">Prepared for Coast &nbsp;·&nbsp; OTM SARL and Geneva Polo Club</div>
</div>
"""

BODY = """
<h2>About This Document</h2><div class="hr"></div>
<p class="lede">This document sets out the work proposed across the engagement: twelve areas
of activity, what each comprises, and the reasoning that earns it a place.</p>
<p>It is a working plan rather than a schedule. It fixes neither dates nor acceptance
conditions, which run through the monthly report under Clause 2.3 of the Services Agreement.
The order of work proposed towards the end is a recommendation, and the reasoning behind it is
set out so that it can be disputed.</p>
<p>Beneath the twelve areas lies work that never appears on a screen: holding the software the
platform depends upon current, and moving the club's hosting into an account the club owns and
pays for directly. It is the work that keeps a difficulty with member data from ever reaching
the association.</p>

<div class="sep"></div>

<h2>The Twelve Areas</h2><div class="hr"></div>
<div class="toc">
<div><span class="n">1</span><span>Event finance reconciliation</span></div>
<div><span class="n">2</span><span>Media management platform</span></div>
<div><span class="n">3</span><span>Event distribution and external ticketing</span></div>
<div><span class="n">4</span><span>Conversion optimisation</span></div>
<div><span class="n">5</span><span>Comms strategy</span></div>
<div><span class="n">6</span><span>Consolidate leads and contacts</span></div>
<div><span class="n">7</span><span>Discount codes</span></div>
<div><span class="n">8</span><span>Corporate membership growth</span></div>
<div><span class="n">9</span><span>Phone: identity, login and the WhatsApp channel</span></div>
<div><span class="n">10</span><span>Contacts and systems architecture</span></div>
<div><span class="n">11</span><span>Orchestration into introductions</span></div>
<div><span class="n">12</span><span>Member portal engagement</span></div>
</div>

<div class="page"></div>
<h2>Already in Place</h2><div class="hr"></div>
<p>The platform running today was built before the engagement's effective date. The fee does
not reflect it, and it continues to earn its keep.</p>

<div class="pair"><h4>Events and ticketing</h4>
<p>Events with several ticket types and rates. Booking with card payment. A waiting list that
can offer paid places when seats free up. Extra places and upgrades added to an existing
booking. Cancellations, guest lists and complimentary places.</p></div>

<div class="pair"><h4>At the door</h4>
<p>Ticket scanning and bracelet access. A check-in screen with a live arrivals list. Guests
naming their own places, household tickets, and the waiver signed at entry. A printable list
for doors checked by hand.</p></div>

<div class="pair"><h4>Membership</h4>
<p>Applications through review, approval and decline. A member area with dashboard, profile,
events, digital card and regulations. Renewals, honorary renewals, and the return of lapsed
members. Membership levels. Referral credit. Public card verification.</p></div>

<div class="pair"><h4>Money</h4>
<p>Card payment for both events and membership. Payment retry links. Refunds issued by an
administrator. A finance view covering membership and per-event income, with refunds deducted.</p></div>

<div class="pair"><h4>Communication</h4>
<p>Every transactional message on managed templates. Broadcasts with drafts, audience preview
and send. Messaging for a single event. Five automatic reminder streams.</p></div>

<div class="pair"><h4>Administration</h4>
<p>An administration area with role-based access. Scheduled tasks with a screen to inspect and
run them. Template editing. Lounge sessions. Mobile-ready throughout.</p></div>

<div class="page"></div>
<h2>The Work</h2><div class="hr wide"></div>
<p class="lede">Twelve areas, what each contains, and the argument for it.</p>

<div class="item">
<h3>1. Event Finance Reconciliation</h3><div class="hr"></div>
<p>Every franc that moves is traceable to the booking that caused it, and every booking that
claims money names the payment that carried it. A per-event profit and loss sits downstream of
that, and is worth little without it.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li><strong>Payment attribution.</strong> Every record that moved money names the payment that
moved it — bookings, added places, upgrades, refunds. This is the foundation; the remainder is
reporting.</li>
<li><strong>Extra places.</strong> When a guest adds places themselves, the platform charges,
issues and records in one motion. When an administrator adds them, the seats move but the money
does not — so the places are given away without anyone deciding to. Both paths onto one record.</li>
<li><strong>Refund reconciliation.</strong> Refunds are issued from the roster with nothing
confirming they settled, so a refund that fails leaves the club reporting a figure that never
happened. Reconcile issued against settled, and surface cancellations that freed a seat but
never returned the money.</li>
<li><strong>A check in both directions.</strong> Every payment received maps to a booking, and
every booking claiming income maps to a payment. One direction catches money the club holds and
cannot attribute; the other catches income reported but never collected.</li>
<li><strong>Complimentary places recorded as such</strong>, so a booking made by hand is
distinguishable from a purchase that lost its payment record. At present the two look
identical.</li>
<li><strong>Externally sold tickets</strong> reconciled into the same per-event picture. Income
covering only what the platform sold is not the event's income.</li>
<li><strong>A ledger for every event.</strong> Beneath each event, a line-by-line record: each
booking, and within it the original payment, places added later, upgrades and refunds.</li>
<li><strong>A leaderboard of the club's largest supporters</strong>, ranking contacts by what
they have spent across tickets and membership together, by season and lifetime.</li>
<li><strong>Per-event profit and loss, and committee reporting</strong>, per event and per
season — once the points above make the underlying figures trustworthy.</li>
<li>Deposit handling, and payments authorised now but taken later.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> a committee cannot defend a
figure it had to assemble by hand, and a season is difficult to close when income arrives by
routes the records treat differently.</p>
<p>The finance area already opens membership income down to its individual payments, and
referral credit down to the transactions beneath it. Event income alone has nothing underneath
— though the detail exists, since it can be exported to a spreadsheet. It is withheld from the
screen rather than absent from the system.</p>
<p>The leaderboard answers a question the club currently cannot: who to invite, who to approach
about corporate membership, and whom the club would most miss. A rough version is already
computable — the leading contact has spent CHF 2,960 across two bookings and a membership. Three
things must be settled before the figure can be trusted: that one person is recognised across
their several email addresses, that a lead booking a table of twelve is not simply recorded as
the spender, and that refunds are deducted.</p></div>
<p class="dep"><strong>Note:</strong> discount codes and corporate billing open this same payment
path. Build the three together rather than opening it three times.</p>
</div>

<div class="item">
<h3>2. Media Management Platform</h3><div class="hr"></div>
<p>An image and video library for the club, holding photography and match footage, hosted by the
club itself. Commissioned photographers and videographers deposit their work directly into it.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li>A central library for photography and footage, replacing material held on personal phones.</li>
<li>Background backup from committee and photographer phones, so footage arrives without anyone
remembering to send it.</li>
<li>Tagging, albums, and search by what an image actually shows.</li>
<li>Face recognition, for finding a member across a season.</li>
<li>An album per event.</li>
<li>A durable archive that survives committee turnover.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> the club's visual record is
dispersed across personal phones, SharePoint and individual hard drives. Recovering a particular
photograph or clip means asking several people and trusting that one of them has kept it;
anything held on a personal device departs with its owner. Video fares worst, the files being
large enough that they are seldom shared at all.</p>
<p>The saving falls in two places. <strong>In operation</strong>, photographers and
videographers deposit work directly rather than sending files to be gathered, renamed and filed
by hand. <strong>In preparation</strong>, whoever is assembling a post, a newsletter or a sponsor
pack searches one place, instead of spending an afternoon in pursuit of an image.</p></div>
<h4 class="sub2">What it does not do, and needs a decision</h4>
<p>The chosen platform is a photo manager rather than a rights system. It does not record who
shot an image, what it may be used for, or whether the subject consented; it has no approval
step before publication. The club publishes photographs of identifiable members, sponsors and
children, so this is a governance question rather than a feature preference — see decision 1.</p>
<p class="dep"><strong>Running costs</strong> sit with the client under Clause 2.5: server,
storage and processing. Video is what drives the figure, and it is better named before
deployment than after the first invoice.</p>
</div>

<div class="item">
<h3>3. Event Distribution and External Ticketing</h3><div class="hr"></div>
<p>One event record, published outward to channels that list it and to channels that sell it.
Two different depths of work, and worth separating when estimating.</p>
<h4 class="sub2">Channels that list</h4>
<ul>
<li>One publish action driving every channel: Eventfrog, Genève Tourisme, the club's Facebook
and LinkedIn pages.</li>
<li>English translations of event copy, required before Genève Tourisme will carry a listing.</li>
<li>Listings link back to the club's own page. Ticketing stays there, so the club keeps both the
guest's details and the payment relationship.</li>
</ul>
<h4 class="sub2">Channels that sell</h4>
<ul>
<li>Guest lists drawn in automatically from each channel.</li>
<li><strong>A door credential issued for every externally sold ticket</strong>, ahead of the
event, so the existing door and roster work unchanged. Without it, a guest arrives holding a
ticket the door cannot read.</li>
<li>The waiver captured from those guests on the same terms as anyone else.</li>
<li>Money collected elsewhere reconciled into that event's accounts.</li>
<li>Every guest list consolidated into the club's contact records.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> listing is straightforward.
Selling elsewhere is not, and it is by some distance the more consequential half. A guest who
buys on another platform must still arrive holding something the door can read; the money must
still reconcile into that event's accounts; and their details must still reach the club's own
records. All three are the club's responsibility rather than the channel's.</p>
<p>Handled well, an outside channel becomes a source of members. Handled poorly, the club pays a
commission for the privilege of losing all three.</p>
<p>The consideration is sharpest for COPA SAN MARTÍN, the largest gathering of the year and the
one ticketed outside the platform. Its guests do reach the club's records today — but by hand,
at roughly an hour of someone's time for each event, with the income reconciled separately
afterwards. An import returns that hour and removes the transcription errors any retyped list
carries.</p></div>
<p class="dep"><strong>From the club:</strong> organiser accounts for each channel.
<strong>Depends on</strong> area 10 for the record-ownership and credential decisions.</p>
</div>

<div class="item">
<h3>4. Conversion Optimisation</h3><div class="hr"></div>
<p>Measuring the passage from guest to member, and the booking that precedes it — then improving
whichever step loses the most people.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li><strong>Guest-to-member conversion, measured.</strong> The proportion of those who attend
who go on to join. It is the club's stated scoreboard and nothing computes it today.</li>
<li><strong>The booking steps defined and instrumented.</strong> Analytics are already installed
and recording visits and errors, but nothing marks a step in the booking itself — seeing an
event, beginning a registration, paying, confirming. Until those exist there is no view of where
a guest falls away.</li>
<li>Removing friction at checkout, directed by what the measurements disclose.</li>
<li>Testing the event page: wording, imagery, how price is presented.</li>
<li>Attribution by channel, so distribution effort can be judged rather than assumed.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> the guest-to-member proportion is
the claim upon which the whole approach rests, and it cannot be produced today without being
assembled by hand — the club is investing in a conversion it cannot yet observe.</p>
<p>What that assembly currently yields is instructive. Across all event data, three people
appear as guests before their membership exists; thirty others attended events they came to as
members already. The reporting cannot presently distinguish the two.</p>
<p>Nor can anyone see where a prospective guest abandons a booking, so adjustments to pricing or
wording are conjecture and their effect cannot be judged afterwards.</p></div>
<p class="dep"><strong>Sequencing:</strong> measure before area 3 goes live — publishing without
measurement produces visitors nobody can appraise. <strong>Depends on</strong> area 6: both
figures rest on recognising the same person across events.</p>
</div>

<div class="item">
<h3>5. Comms Strategy</h3><div class="hr"></div>
<p>What the club sends, to whom, and which of it should run without anyone remembering. A
strategy exercise first and a build second.</p>
<h4 class="sub2">What already runs unattended</h4>
<p>Event reminders, hourly. Renewal reminders, payment reminders, committee reminders and
membership expiry, daily. Every transactional message — tickets, receipts, confirmations,
waiting-list offers, household tickets, cancellations — as it is needed. Broadcasts composed by
hand, with drafts and audience preview.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li>The strategy itself: what is sent, to which group, upon what occasion, and what is
deliberately not sent.</li>
<li><strong>Follow-up after an event</strong>, to those who attended and are not members.</li>
<li>Segmented email against the contact records from area 6.</li>
<li>Broadcast over WhatsApp: one to many, on a channel members cannot post into.</li>
<li>A review of the six existing automations for timing, overlap and tone.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> every lifecycle moment in the
platform is already automated but one, and it is the one that converts:
<strong>nothing is sent after a guest attends</strong>. The crowd is captured at the door and
then nothing reaches them. That is the moment at which someone who has just enjoyed an evening
is likeliest to join, and it is the single moment at which the club says nothing.</p>
<p>The existing community groups are unmoderated and thick with automated accounts. A channel
the club controls supersedes them.</p></div>
<p class="dep"><strong>From the club:</strong> a business WhatsApp account, a dedicated number,
and the Meta business connection. <strong>Depends on</strong> area 6 for a clean list, and area 9
for the numbers to send to.</p>
</div>

<div class="item">
<h3>6. Consolidate Leads and Contacts</h3><div class="hr"></div>
<p>The contact system, built and populated — every contact the club already holds, and every one
it meets from here. This is the closest match in the roadmap to Clause 2.2(a).</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li>Migration of existing contacts from every place they currently sit.</li>
<li>Deduplication and cleaning.</li>
<li>Segmentation: member, prospect, corporate, sponsor, press.</li>
<li>Points of capture designed around how the club actually meets people — at events, on the
field, through introductions.</li>
<li>Lifecycle stages, and the corporate pipeline that extends into area 8.</li>
<li><strong>Every point of capture writing to the contact record as its primary act</strong>,
not as a copy taken afterwards: booking, ticket claim, door check-in, waiting list, membership
application, and externally ticketed events by import. A capture point that does not write to
the contact system is a leak, and at present every one of them is.</li>
<li><strong>One rule for telling people apart.</strong> An email address belongs to the buyer,
not to the booking; a guest on someone else's booking is a contact in their own right, with no
address until they give one. The real work is recognising one person who appears twice across
sources — a nameless attendee last season and a buyer this one.</li>
<li><strong>Consent held per contact and per channel</strong>, with the evidence — the wording
shown, and when — kept at the point where it was given.</li>
<li>An enumeration of every system holding club contacts, with a date on it. An unknown source
discovered mid-migration is what breaks a migration.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> <em class="fig">633</em> people
have registered, bought a ticket or joined a waiting list. <em class="fig">590</em> of them are
not members. They are held in four separate places, with nothing that treats them as one
person, and no record of a contact exists anywhere as such.</p>
<p>Nor is the difficulty merely historical. <em class="fig">129</em> of 542 tickets carry no
email address whatever, and 32 of those people walked through the door. They were met in person
and cannot be reached — no message the club sends will ever arrive, and no migration will
recover them. Directing every point of capture at a single record is what prevents the
recurrence.</p></div>
<p class="dep"><strong>Follows</strong> area 10, which settles record ownership and the identity
rule. <strong>Prerequisite to</strong> areas 5, 4 and 8, and it feeds area 11.</p>
</div>

<div class="item">
<h3>7. Discount Codes</h3><div class="hr"></div>
<h4 class="sub2">What it contains</h4>
<ul>
<li>Generating and managing codes.</li>
<li>Discounts by percentage or by fixed amount.</li>
<li>Codes by membership level, and codes for sponsors.</li>
<li>Limits on use, expiry dates, and restriction to a single event.</li>
<li>Reporting on what was redeemed, feeding back into area 1.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> it allows the club to be generous
deliberately, and to see what that generosity secured. Built alongside the finance work, both
opening the same payment path.</p></div>
<p class="dep"><strong>From the club:</strong> the discount policy — who qualifies, how deep, and
whether offers combine.</p>
</div>

<div class="item">
<h3>8. Corporate Membership Growth</h3><div class="hr"></div>
<p>Driving more corporate memberships. Led by selling rather than by building — but the
selling is supported by the platform, not merely recorded by it.</p>
<h4 class="sub2">The effort</h4>
<ul>
<li>A target list of companies, and the pitch — owned by sales rather than by engineering.</li>
<li>Outreach, and the conversation about price.</li>
<li>Corporate hospitality sold against event capacity, once area 1 makes event income and
capacity trustworthy enough to sell against.</li>
</ul>
<h4 class="sub2">What the platform contributes to the selling</h4>
<p>Built before a first agreement rather than after it, because these are what make the effort
land.</p>
<ul>
<li><strong>A route for a company to come in.</strong> A corporate enquiry and signup path
distinct from the individual one. At present a company interested in membership has nowhere to
arrive but a form written for a single person.</li>
<li><strong>Corporate benefits presented properly</strong> — what such a membership actually
includes, set out so it can be read and compared rather than described in a paragraph.</li>
<li><strong>Lead targeting.</strong> Drawing the account list out of the club's own data rather
than assembling it by hand: which companies are already represented, by how many members, and
at what seniority.</li>
<li><strong>Support for whoever runs the effort</strong> — a view of the pipeline showing who has
been approached, where each account stands, and what was agreed.</li>
<li><strong>Measurement of the corporate path</strong> — enquiry, conversation, agreement — so
the effort can be judged and improved rather than repeated blind.</li>
</ul>
<h4 class="sub2">What follows a first agreement</h4>
<ul>
<li>A company account holding places for named individuals.</li>
<li>Billing at account level, and changes to places within the term.</li>
<li>Individuals joining and leaving independently of the account.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> a corporate member brings several
people and a longer commitment than an individual one. <em class="fig">87</em> of the club's 165
members already name a company — an opening list of organisations already acquainted with the
club rather than a cold one, and one the contact records can surface rather than someone
assembling it by hand.</p>
<p>The account machinery is deliberately held until a company has agreed to join, since it is
straightforward and there is little sense in building it in advance of demand. The work that
comes first is the work that helps win the agreement: somewhere for a company to arrive, a clear
account of what it receives, a prioritised list of whom to approach, and sight of how the effort
is progressing.</p></div>
<p class="dep"><strong>Depends on</strong> area 6 for the target list and the pipeline view,
area 4 for measuring the corporate path, area 12 for the benefits surface, and area 11 to turn a
list into conversations. <strong>From the club:</strong> who owns the effort, and the terms a
first agreement needs — decisions 7 and 8.</p>
</div>

<div class="item">
<h3>9. Phone: Identity, Login and the WhatsApp Channel</h3><div class="hr"></div>
<p>Not merely a matter of data quality. One well-formed number per person is what portal
sign-in, WhatsApp broadcast, and every point of capture all rest upon — the same number serving
three purposes, and so needing to be put right only once.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li>Numbers validated and stored in one international format wherever they are entered.</li>
<li>Capture at every surface: booking, ticket claim, the door, membership application.</li>
<li>Consolidation onto the contact record, so a number given at a door reaches the person's
record rather than remaining on a ticket.</li>
<li>The number as a secondary signal for telling people apart in area 6 — never as the sole
one.</li>
<li><strong>Sign-in by telephone</strong>, alongside or instead of email.</li>
<li><strong>WhatsApp broadcast</strong>, which requires a verified number for each recipient.
The broadcast itself belongs to area 5; this is what makes sending possible.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> signing in by telephone removes
the password from the commonest route by which members reach the platform, and it is what makes
broadcast over WhatsApp possible at all.</p>
<p>The work is nearer than it appears. <em class="fig">132</em> of 165 members already have a
number on file and all but eight are already well formed; a further 288 tickets and 226 bookings
hold numbers stranded where no member record can see them. Sign-in by text message is already
built and awaiting only the club's account details. This is a short undertaking, not a campaign
to gather numbers.</p></div>
<p class="dep"><strong>Sequencing:</strong> the data work belongs with area 6, since telling
people apart needs the tidy field. Sign-in need not wait for the broadcast work and could come
earlier if wanted.</p>
</div>

<div class="item">
<h3>10. Contacts and Systems Architecture</h3><div class="hr"></div>
<p>The written agreement for how people move between systems. Short, and it releases three of
the larger areas.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li><strong>Which system owns which fact</strong>, rather than which system owns the person. The
contact system owns the relationship — stage, segment, owner, notes. The platform owns
attendance, payment and the evidence of consent, being the only one with a door, a card and a
payment record. A tool that merely stores addresses is not thereby a source of truth.</li>
<li><strong>Which way information travels</strong> — one direction per fact, from its owner
outward. Two systems both accepting changes to the same fact fail by drifting apart quietly
rather than by reporting an error.</li>
<li><strong>One rule for telling people apart</strong>, applied by every connection rather than
reinvented for each.</li>
<li><strong>What permission the club holds</strong>, per source.</li>
<li>The credential path for externally sold tickets, feeding area 3.</li>
<li><strong>A named person responsible for each system</strong> — organisational rather than
technical, and what keeps the first point true six months later.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> answered once, these questions are
inexpensive. Answered three times over, differently, by three separate pieces of work, they
become a data clean-up.</p>
<p>The question of permission carries the risk. An address given on a booking form, one imported
from an old mailing list, and one obtained from a ticketing platform do not carry the same
permission to send. Merged into a single list and broadcast to, that distinction disappears —
and under Swiss and European data protection law the association is accountable for it.</p></div>
</div>

<div class="item">
<h3>11. Orchestration into Introductions</h3><div class="hr"></div>
<p>Clause 2.2(c): turning contacts into introductions and opportunities. Distinct from building
the contact system — this is operating it.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li>The signals worth acting upon: who attended what, who has been introduced to whom, and what
has gone quiet.</li>
<li>A prompt to the right person at the right moment, rather than a report nobody opens.</li>
<li>Introductions tracked: made, accepted, and what came of them.</li>
<li>Feeding the private assistant, which is where this becomes leverage rather than
administration.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> building the contact system and
operating it are distinct undertakings. The first yields an orderly record; only the second
yields introductions and opportunities. It is likewise the mechanism beneath corporate growth in
area 8 — a target list becomes revenue through conversation, not through software.</p></div>
</div>

<div class="item">
<h3>12. Member Portal Engagement</h3><div class="hr"></div>
<p>The between-events reason to sign in. Conversion does not hold if there is nothing behind the
door.</p>
<h4 class="sub2">Where it stands today</h4>
<p>The member area is largely passive: a welcome, membership status and level, the next four
events, a digital card, and a fixed weekly lounge schedule with no means of booking. What a
membership is worth is a paragraph of text shown once at joining, rather than anything a member
can browse. The single section aimed at ongoing engagement is a link out to the club's WhatsApp
group — the same group area 5 proposes to supersede.</p>
<h4 class="sub2">What it contains</h4>
<ul>
<li><strong>Member benefits made real</strong> — a directory a member can browse, rather than a
paragraph describing one.</li>
<li><strong>Something in the portal worth opening between events</strong>, so its own engagement
surface stops directing members elsewhere.</li>
<li><strong>Event recaps and photography</strong>, drawing on area 2's library.</li>
<li><strong>Lounge booking</strong>, turning the fixed schedule into an actual reservation.</li>
<li><strong>A member directory</strong>, by choice rather than by default — and a source for the
introductions in area 11.</li>
</ul>
<div class="why"><p><span class="lbl">Why this matters:</span> a membership worth something only
on event days is a membership that lapses. At present the platform's answer to "why return"
directs members away from the platform.</p></div>
<p class="dep"><strong>Depends on</strong> area 2 for recaps, area 6 for the member data a
directory needs, and area 11 for introductions once a directory exists.</p>
</div>

<div class="page"></div>
<h2>Order of Work</h2><div class="hr wide"></div>
<p class="lede">A recommendation, and the reasoning that produced it.</p>

<div class="phase"><span class="tag">First</span><p><strong>Housekeeping.</strong> Bring the
software the platform depends upon up to date. Small, unglamorous, and it grows only if
neglected.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Agree how the systems fit
together</strong> (area 10). A short written decision rather than a build. Three of the larger
areas wait upon it, and each becomes cheaper for having it.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Money</strong> (areas 1 and 7),
which share a payment path and are therefore built together rather than opened twice.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>One record per person</strong>
(area 6, with the phone work inside it). The COPA SAN MARTÍN guest list belongs here too —
ahead of the event, not after it.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Communication</strong> (area 5), once
the contact list is sound. A broadcast against a poor list is worse than no broadcast at all.
Post-event follow-up is the first thing to build.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Reach</strong> — measurement first,
then publication to outside channels, then improvement of what the measurements disclose.
Publishing without measurement produces visitors nobody can appraise.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Introductions</strong> (area 11), once
there is a populated contact record to work from.</p></div>

<div class="phase"><span class="tag">Then</span><p><strong>Photography</strong> (area 2),
followed by <strong>the member area</strong> (area 12), which draws on it for recaps. Two parts
of area 12 — member benefits and lounge booking — depend on neither and could come forward if
the club wants that value sooner.</p></div>

<div class="why" style="margin-top:6mm"><p>Corporate growth (area 8) is a selling effort and
proceeds alongside all of this rather than waiting for a place in the sequence. Its platform
work joins the money phase once a first agreement is close.</p></div>

<div class="sep"></div>

<h2>Also in the Engagement</h2><div class="hr"></div>

<div class="item">
<h3>A Private Assistant</h3><div class="hr"></div>
<p>Clause 2.2(b): a private assistant on a dedicated secure server, established and tuned
across the term, connected to the contact records and the pipeline as they take shape. It is
the most personally useful thing the engagement produces, and it belongs early — alongside the
contact work rather than following it.</p>
</div>

<div class="item">
<h3>Coaching</h3><div class="hr"></div>
<p>Clause 2.1: two sessions a month, CHF 500 monthly across the year. The value lies in
holding the slot. An unused session converts to a written brief or a recording, or carries over
into build work at the same value — it is not forfeited, though it is easily undercounted
precisely because nothing is built.</p>
</div>
</div>

<div class="page"></div>
<h2>What We Need From You</h2><div class="hr wide"></div>
<p class="lede">Decisions that shape the work. Several release more than one area.</p>

<div class="dec"><span class="n">1</span><p><strong>Photography, permission and consent.</strong>
Handle it through club process, add a light consent record to the photo library, or pair it with
a system built for rights. This decides how much the photography work costs.</p></div>

<div class="dec"><span class="n">2</span><p><strong>Where the photo library runs, and the storage
budget for video.</strong> Video is what drives the cost. Under Clause 2.5 running costs sit with
the client, so the figure is better named before it appears on an invoice.</p></div>

<div class="dec"><span class="n">3</span><p><strong>Discount policy.</strong> Who qualifies, how
deep, and whether offers can be combined.</p></div>

<div class="dec"><span class="n">4</span><p><strong>Phone numbers already on file.</strong>
Whether a number given when booking a ticket may be added to that person's member record without
asking them again, and what the club says at the point of capture.</p></div>

<div class="dec"><span class="n">5</span><p><strong>The private assistant</strong> named in
Clause 2.2(b): where it runs, and what it is allowed to see.</p></div>

<div class="dec"><span class="n">6</span><p><strong>Whether OTM and the Geneva Polo Club
association are treated as one party or two</strong> for this engagement.</p></div>

<div class="dec"><span class="n">7</span><p><strong>Who owns corporate membership growth</strong>
— a dedicated sales role, or existing committee capacity carrying it alongside everything else.
It is the difference between an effort and an intention.</p></div>

<div class="dec"><span class="n">8</span><p><strong>Corporate terms</strong>, once a first
conversation is close: how many places per level, what a place costs, who may reassign one, and
what happens to those people if the company does not renew.</p></div>

<div class="dec"><span class="n">9</span><p><strong>COPA SAN MARTÍN guest details.</strong>
Whether the ticketing provider will release them, in what form, and on what basis the club may
then contact those people.</p></div>

<div class="dec"><span class="n">10</span><p><strong>The existing mailing list.</strong> It stops
being a second source of truth either way. Whether it remains the tool the club sends from is a
separate question — the platform can already do it, but the existing tool is easier for a
non-technical hand to compose in. Worth settling who actually writes the newsletters before
choosing.</p></div>

<div class="dec"><span class="n">11</span><p><strong>Consent wording at each point of
contact:</strong> who drafts it, who approves it, and whether it differs by channel.</p></div>
</div>
"""

def doc(inner, extra_css=""):
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<title>Geneva Polo Club — Delivery Roadmap</title>"
            f"<style>{CSS}{extra_css}</style></head><body>{inner}</body></html>")

cover_html = doc(COVER.replace("__LOGO__", LOGO), "@page{ size:A4; margin:0; }")
body_html = doc(BODY)

(OUT / "_roadmap_cover.html").write_text(cover_html)
(OUT / "_roadmap_body.html").write_text(body_html)
print(f"cover {len(cover_html)/1024:.0f} KB   body {len(body_html)/1024:.0f} KB")
