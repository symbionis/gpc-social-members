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

.stats{ width:100%%; border-collapse:collapse; margin:2mm 0 4mm; }
.stats tr{ page-break-inside:avoid; }
.stats td{ padding:2.4mm 0; border-bottom:1px solid var(--rule); font-size:9.8pt; }
.stats td:last-child{ text-align:right; font-family:'Playfair'; font-weight:700;
                      font-size:12.5pt; color:var(--marine); white-space:nowrap; }
.stats tr:last-child td{ border-bottom:none; }
.ba{ margin:0 0 3mm; }
.ba strong{ color:var(--skyd); font-weight:600; }
""" % F

COVER = """
<div class="cover">
  <div class="crule"></div>
  <img src="data:image/png;base64,__LOGO__" alt="">
  <div class="kick">Geneva Polo Social Club</div>
  <h1>Every Guest<br>Has a Name</h1>
  <div class="urule"></div>
  <div class="kick2">Platform Progress Report</div>
  <div class="date">June &ndash; August 2026</div>
  <div class="prep">Prepared for Thierry &amp; the Geneva Polo Club team</div>
</div>
"""

BODY = """
<h2>The Big Picture</h2><div class="hr"></div>
<p>The last report covered the platform learning to run the club's events: pages, ticket sales,
a member area, communications. It worked, but it counted <strong>seats</strong>. A booking for
four was four places against a limit — the club knew who had paid, and nothing at all about the
other three.</p>
<p>Since June the platform has learned to count <strong>people</strong>. Every ticket now belongs
to a named person holding their own code for the door. Guests receive their own ticket rather
than a forwarded screenshot; they can add a name, correct a spelling, upgrade, cancel, or sign
the waiver before they arrive. The door scans a code and shows who has just walked in.</p>
<p>That single change runs through everything below. The door, the guest list, the waiting list,
refunds and the finance view all rest upon knowing who is coming rather than how many.</p>
<p>Ten events ran on it in eleven weeks.</p>

<div class="sep"></div>

<div class="item">
<h3>1. Every Ticket Belongs to a Named Person</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> a booking recorded the buyer and a number. Four places
meant one name and three strangers. Guests arrived as "plus three", and the club had no way to
reach them either before or after.</p>
<p class="ba"><strong>Now:</strong> every seat is a ticket with a holder.</p>
<ul>
<li><strong>Names are required at checkout</strong> — first and last name for every place, not
only the buyer's.</li>
<li><strong>Each guest receives their own ticket by email</strong>, with their own code. No
forwarding a screenshot and hoping.</li>
<li><strong>Household bookings stay together</strong> — a couple or family booking on one address
receives a single message containing each person's ticket.</li>
<li><strong>Guests correct their own details</strong> — a misspelt name or a wrong address is put
right by the guest rather than by an administrator.</li>
<li><strong>No code, no bracelet</strong> — stated plainly in the ticket email, so guests arrive
expecting to be scanned.</li>
</ul>
<div class="why"><p><span class="lbl">What changed for the club:</span> of 543 tickets issued this
period, 478 carry a named holder. Those are people the club can recognise at the gate, seat
correctly, and contact afterwards — where before there was a number.</p></div>
</div>

<div class="item">
<h3>2. The Door Runs on Scans</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> door staff worked from a printed list or a phone, matching
names by eye and marking people off by hand. A busy gate meant queues and guesswork.</p>
<p class="ba"><strong>Now:</strong> a check-in console built for standing outside in the sun.</p>
<ul>
<li><strong>Scan to admit</strong> — the guest's code is scanned and the screen states who they
are and whether they are expected.</li>
<li><strong>A live arrivals list</strong>, updating as people come in.</li>
<li><strong>The waiver on screen, full size</strong>, signed at the gate by anyone who has not
already signed.</li>
<li><strong>Guest lists shown separately</strong>, grouped by the member who invited them.</li>
<li><strong>A printed sheet as a fallback</strong> — an A to Z roster for doors worked by hand,
with leads in bold and their guests indented beneath.</li>
<li><strong>Cancelled places no longer appear</strong>, so a refunded seat cannot be admitted by
mistake.</li>
</ul>
<div class="why"><p><span class="lbl">Time saved:</span> the door no longer needs someone
cross-referencing a list. 180 arrivals were recorded by scan this period, each one landing in
the club's records at the moment it happened.</p></div>
</div>

<div class="item">
<h3>3. Guests Manage Their Own Booking</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> every change passed through an administrator. A name to
correct, a guest swapped, an extra place wanted — all of it arrived by message and was done by
hand.</p>
<p class="ba"><strong>Now:</strong> each booking has its own page, and so does each ticket.</p>
<ul>
<li><strong>Name or rename a place</strong>, up to the moment of the event.</li>
<li><strong>See every ticket in the booking</strong>, with each person's code.</li>
<li><strong>Sign the waiver in advance</strong>, so the gate moves faster.</li>
<li><strong>Cancel a place</strong>, which frees the seat for someone else immediately.</li>
</ul>
<div class="why"><p><span class="lbl">Time saved:</span> the administrator is no longer the route
through which every small change must pass. Corrections that were once a message and a manual
edit now happen without anyone at the club being involved.</p></div>
</div>

<div class="item">
<h3>4. Buying More, and Moving Up</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> a guest wanting an extra place, or a better ticket, had to
book again separately or ask for an invoice.</p>
<p class="ba"><strong>Now:</strong> both happen from the booking itself.</p>
<ul>
<li><strong>Add places to an existing booking</strong> — paid for immediately, tickets issued at
once.</li>
<li><strong>Upgrade a ticket</strong> and pay only the difference.</li>
<li><strong>One price everywhere</strong> — the rate a person sees when booking, adding or
upgrading comes from a single source, so a member rate remains a member rate throughout.</li>
<li><strong>An itemised receipt</strong> on the confirmation, showing what was bought at what
price.</li>
</ul>
</div>

<div class="item">
<h3>5. The Waiting List Now Sells</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> the waiting list collected names. When a place freed up,
someone had to notice, choose a person, write to them, and take payment separately.</p>
<p class="ba"><strong>Now:</strong> the club sends a paid offer.</p>
<ul>
<li><strong>Offer a place to a named person</strong> on the list, with a link that lets them pay
and claim it.</li>
<li><strong>The offer is theirs alone</strong> — it cannot be forwarded and used by someone
else.</li>
<li><strong>The system refuses to over-promise</strong> — offers are blocked once an event is
full, with a warning before an administrator may create one regardless.</li>
</ul>
<div class="why"><p><span class="lbl">What changed for the club:</span> a returned ticket becomes
revenue rather than an empty seat, and the sequence runs without anyone tracking who was asked
first.</p></div>
</div>

<div class="item">
<h3>6. Guest Lists and Complimentary Places</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> complimentary guests were a workaround — a free booking
made by hand, with no record of who had invited whom.</p>
<p class="ba"><strong>Now:</strong> guest lists are a proper part of an event.</p>
<ul>
<li><strong>Add a guest list against an event</strong>, with places allocated to named guests.</li>
<li><strong>The door sees them grouped by sponsor</strong>, so it is clear who invited whom.</li>
<li><strong>The roster shows how each seat was obtained</strong> — bought, complimentary, or from
the guest list.</li>
<li><strong>The complimentary share is visible</strong> in the event overview, rather than hidden
inside the headcount.</li>
</ul>
</div>

<div class="item">
<h3>7. Money in One Place</h3><div class="hr"></div>
<p class="ba"><strong>Before:</strong> income was visible as individual payments. Working out
what an event had made, or what a member had paid, meant assembling it by hand.</p>
<p class="ba"><strong>Now:</strong> a finance area, with its own access level so a treasurer may
see the money without seeing everything else.</p>
<ul>
<li><strong>Membership and event income together</strong>, by month and by season.</li>
<li><strong>Refunds issued from the platform</strong>, and deducted from the figures rather than
sitting outside them.</li>
<li><strong>Cancellations release the seat immediately</strong> and are recorded as
refundable.</li>
<li><strong>Referral credit per originator</strong>, with a monthly breakdown and a link through
to the payment behind each figure.</li>
<li><strong>Date paid</strong> shown against each member.</li>
</ul>
<div class="why"><p><span class="lbl">What changed for the club:</span> 110 paid bookings and
CHF 14,185 of event income this period, visible in one place rather than reconstructed from
receipts.</p></div>
</div>

<div class="item">
<h3>8. Less to Go Wrong</h3><div class="hr"></div>
<p>Not everything worth doing adds a feature. Four things were removed this period, each of them
a source of confusion or of mistakes.</p>
<ul>
<li><strong>Children's tickets</strong> — a separate ticket type with its own rules and its own
gate at the door. Every ticket now carries a name and a waiver regardless of age, which is both
simpler and safer.</li>
<li><strong>Ticket forwarding</strong> — passing a ticket to someone else was a second way of
doing what naming a guest already does, and it produced tickets nobody could account for.</li>
<li><strong>Public self-check-in</strong> — guests checking themselves in from their phones meant
arrivals the door had not seen. Check-in is now the door's business alone.</li>
<li><strong>Two ways to buy</strong> — buying a ticket and adding one to an existing booking
followed separate paths. They now share one, so a change to pricing or rules applies to both.</li>
</ul>
<div class="why"><p><span class="lbl">What changed for the club:</span> fewer paths through the
same task means fewer ways for a guest to end up in a state nobody planned for.</p></div>
</div>

<div class="item">
<h3>9. Behind the Scenes</h3><div class="hr"></div>
<p>Work that never appears on a screen, and matters most when it is absent.</p>
<ul>
<li><strong>Member data closed off.</strong> Several records holding member names and addresses
could be read by anyone who knew where to look. That is closed, everywhere, and verified.</li>
<li><strong>Faults report themselves.</strong> Errors in the live platform now arrive with enough
detail to find the cause.</li>
<li><strong>The build no longer depends on an outside service</strong> being available at the
moment it runs.</li>
<li><strong>Signing in works with iPhone's code autofill</strong>, which had been failing
silently.</li>
<li><strong>Twenty-one changes to the live system</strong> that had been applied without being
recorded were recovered and written down, so the platform's history is complete again.</li>
</ul>
</div>

<div class="page"></div>
<h2>By the Numbers</h2><div class="hr wide"></div>
<p class="lede">1 June to 18 August 2026</p>
<table class="stats">
<tr><td>Events run on the platform</td><td>10</td></tr>
<tr><td>Tickets issued</td><td>543</td></tr>
<tr><td>Tickets carrying a named holder</td><td>478</td></tr>
<tr><td>Arrivals scanned at the door</td><td>180</td></tr>
<tr><td>Paid bookings</td><td>110</td></tr>
<tr><td>Event income</td><td>CHF 14,185</td></tr>
<tr><td>Complimentary and guest-list places</td><td>162</td></tr>
<tr><td>New members</td><td>26</td></tr>
<tr><td>Changes released</td><td>123</td></tr>
<tr><td>Database changes</td><td>62</td></tr>
</table>

<div class="sep"></div>

<h2>What This Sets Up</h2><div class="hr"></div>
<p>Every improvement above rests upon the same foundation: the club now knows, by name, who came
to what. That is the raw material for the next stage — following up with the guests who
attended, understanding how many of them join, and turning a crowd into members rather than a
headcount.</p>
<p>The roadmap covers that ground separately.</p>
"""

def doc(inner, extra_css=""):
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<title>Geneva Polo Club — Delivery Roadmap</title>"
            f"<style>{CSS}{extra_css}</style></head><body>{inner}</body></html>")

cover_html = doc(COVER.replace("__LOGO__", LOGO), "@page{ size:A4; margin:0; }")
body_html = doc(BODY)

(OUT / "_report_cover.html").write_text(cover_html)
(OUT / "_report_body.html").write_text(body_html)
print(f"cover {len(cover_html)/1024:.0f} KB   body {len(body_html)/1024:.0f} KB")
