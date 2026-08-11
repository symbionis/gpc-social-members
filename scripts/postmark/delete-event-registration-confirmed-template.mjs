#!/usr/bin/env node
// Delete the retired "event-registration-confirmed" Postmark template (U4). It combined the
// payer's single ticket QR with their receipt; nothing sends it any more — the confirmation
// sender now sends "event-receipt" (no QR, no manage link) and the payer's own QR travels on
// "event-household-tickets" instead. Run once by someone holding the server token:
//
//   POSTMARK_SERVER_TOKEN=xxxxxxxx node scripts/postmark/delete-event-registration-confirmed-template.mjs
//
// Idempotent: a 404 (already deleted / never existed) is treated as success.

const token = process.env.POSTMARK_SERVER_TOKEN;
if (!token) {
  console.error("POSTMARK_SERVER_TOKEN is required.");
  process.exit(1);
}

const ALIAS = "event-registration-confirmed";
const headers = {
  Accept: "application/json",
  "X-Postmark-Server-Token": token,
};

const existing = await fetch(`https://api.postmarkapp.com/templates/${ALIAS}`, { headers });
if (existing.status === 404) {
  console.log(`Template "${ALIAS}" not found — nothing to delete (already retired).`);
  process.exit(0);
}
if (!existing.ok) {
  console.error(`Lookup failed (${existing.status}):`, await existing.json().catch(() => ({})));
  process.exit(1);
}

const res = await fetch(`https://api.postmarkapp.com/templates/${ALIAS}`, {
  method: "DELETE",
  headers,
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Delete failed (${res.status}):`, body);
  process.exit(1);
}
console.log(`Deleted template "${ALIAS}":`, body);
