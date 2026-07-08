#!/usr/bin/env node
// Upsert the "event-ticket" Postmark template (the guest entry-QR email). The app never
// creates templates at runtime (the admin tool only edits existing ones), so this must be
// run by someone with the server token to create it — or to push body/subject changes.
//
//   POSTMARK_SERVER_TOKEN=xxxxxxxx node scripts/postmark/create-event-ticket-template.mjs
//
// Idempotent: creates the alias if missing, otherwise edits the existing template in
// place. Body is read from docs/email-templates/event-ticket.{html,txt}.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const token = process.env.POSTMARK_SERVER_TOKEN;
if (!token) {
  console.error("POSTMARK_SERVER_TOKEN is required.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, "..", "..", "docs", "email-templates");
const htmlBody = readFileSync(join(templatesDir, "event-ticket.html"), "utf8");
const textBody = readFileSync(join(templatesDir, "event-ticket.txt"), "utf8");

const payload = {
  Name: "Event Ticket (guest QR)",
  Alias: "event-ticket",
  Subject: "Your ticket for {{event_title}}",
  HtmlBody: htmlBody,
  TextBody: textBody,
  TemplateType: "Standard",
  // Same layout as the other event emails (header/footer chrome). Must match the alias
  // used by event-registration-confirmed etc.
  LayoutTemplate: "main-polo-club",
};

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Postmark-Server-Token": token,
};

// Does the alias already exist? GET 200 → edit (PUT); 404 → create (POST).
const existing = await fetch(`https://api.postmarkapp.com/templates/${payload.Alias}`, { headers });
const isUpdate = existing.ok;
const url = isUpdate
  ? `https://api.postmarkapp.com/templates/${payload.Alias}`
  : "https://api.postmarkapp.com/templates";

const res = await fetch(url, {
  method: isUpdate ? "PUT" : "POST",
  headers,
  body: JSON.stringify(payload),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Failed (${res.status}):`, body);
  process.exit(1);
}
console.log(`${isUpdate ? "Updated" : "Created"} template:`, {
  TemplateId: body.TemplateId,
  Alias: body.Alias,
  Name: body.Name,
});
