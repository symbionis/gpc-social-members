#!/usr/bin/env node
// One-time backfill: email each already-named guest their own entry-QR via the
// event-ticket template — mirrors lib/email/ticket-qr.ts (per ticket, inviter name,
// stamp tickets.qr_email_sent_at so the deployed auto-send never double-sends).
//
//   POSTMARK_SERVER_TOKEN=.. SUPABASE_URL=.. SUPABASE_SERVICE_ROLE_KEY=.. \
//     EVENT_ID=a82d3b71-... [DRY_RUN=1] node scripts/postmark/backfill-guest-qr.mjs
//
// DRY_RUN=1 lists recipients and sends nothing. Without it, it sends + stamps.

const pmToken = process.env.POSTMARK_SERVER_TOKEN;
const sbUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const eventId = process.env.EVENT_ID;
const appUrl = (process.env.APP_URL || "https://social.genevapolo.com").replace(/\/$/, "");
const dry = process.env.DRY_RUN === "1";
if (!pmToken || !sbUrl || !sbKey || !eventId) {
  console.error("Need POSTMARK_SERVER_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVENT_ID");
  process.exit(1);
}

const sb = (path) =>
  fetch(`${sbUrl}/rest/v1/${path}`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Accept: "application/json" },
  }).then((r) => r.json());

const DATE_FMT = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const fmtDate = (d) => (d ? new Intl.DateTimeFormat("en-GB", DATE_FMT).format(new Date(d)) : null);
const fmtTime = (t) => (t ? String(t).slice(0, 5) : null);
const first = (n) => (n ? n.trim().split(/\s+/)[0] : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Event details (constant for all recipients).
const [event] = await sb(
  `events?id=eq.${eventId}&select=title,start_date,start_time,location`
);
if (!event) { console.error("event not found"); process.exit(1); }

// Target set: claimed, non-lead, non-child, live, has email, not yet QR-emailed.
const tickets = await sb(
  `tickets?event_id=eq.${eventId}` +
    `&slot_status=eq.claimed&is_lead=eq.false&is_child=eq.false` +
    `&released_at=is.null&qr_email_sent_at=is.null&email=not.is.null` +
    `&select=id,name,email,credential_token,event_registrations(name,reference_code)`
);
const targets = tickets.filter((t) => (t.email || "").trim() && t.credential_token);

console.log(`Event: ${event.title} — ${targets.length} guest ticket(s), ${new Set(targets.map((t) => t.email.toLowerCase())).size} distinct email(s).`);
if (dry) {
  for (const t of targets) console.log(`  ${t.name || "(no name)"} <${t.email}>  inviter=${t.event_registrations?.name ?? "—"}`);
  console.log("DRY_RUN — nothing sent.");
  process.exit(0);
}

let sent = 0, failed = 0;
for (const t of targets) {
  const guestName = (t.name || "").trim() || null;
  const booker = (t.event_registrations?.name || "").trim();
  const inviter = booker && booker.toLowerCase() !== (guestName || "").toLowerCase() ? booker : null;
  const model = {
    first_name: guestName ? first(guestName) : null,
    guest_name: guestName,
    inviter_name: inviter,
    event_title: event.title,
    event_date_label: fmtDate(event.start_date),
    event_time: fmtTime(event.start_time),
    event_location: event.location || null,
    reference_code: t.event_registrations?.reference_code ?? null,
    qr_url: `${appUrl}/api/qr/${t.credential_token}`,
    preheader: `Your QR code for ${event.title} — show it at the door to get in.`,
  };
  try {
    const res = await fetch("https://api.postmarkapp.com/email/withTemplate", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": pmToken },
      body: JSON.stringify({
        From: '"Geneva Polo Social Club" <social@genevapolo.com>',
        To: t.email,
        TemplateAlias: "event-ticket",
        TemplateModel: model,
        MessageStream: "outbound",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ErrorCode !== 0) throw new Error(`Postmark ${res.status} ${body.Message || ""}`);
    // Stamp only on a successful send (idempotency for the deployed auto-send).
    const patch = await fetch(`${sbUrl}/rest/v1/tickets?id=eq.${t.id}`, {
      method: "PATCH",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ qr_email_sent_at: new Date().toISOString() }),
    });
    if (!patch.ok) console.error(`  ⚠ sent but stamp failed for ${t.id} (${patch.status})`);
    sent++;
    console.log(`  ✓ ${t.email}${inviter ? ` (from ${inviter})` : ""}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${t.email}: ${err.message}`);
  }
  await sleep(150);
}
console.log(`Done: ${sent} sent, ${failed} failed.`);
