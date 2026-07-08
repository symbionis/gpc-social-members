#!/usr/bin/env node
// One-off: create the "event-ticket" Postmark template (the guest entry-QR email).
// The app never creates templates at runtime (the admin tool only edits existing ones),
// so this must be run once by someone with the server token.
//
//   POSTMARK_SERVER_TOKEN=xxxxxxxx node scripts/postmark/create-event-ticket-template.mjs
//
// Idempotent-ish: if the alias already exists Postmark returns 422 — edit it in the admin
// Email Templates tool (or re-run after deleting). Body is read from docs/email-templates.

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

const res = await fetch("https://api.postmarkapp.com/templates", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Postmark-Server-Token": token,
  },
  body: JSON.stringify(payload),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Failed (${res.status}):`, body);
  process.exit(1);
}
console.log("Created template:", { TemplateId: body.TemplateId, Alias: body.Alias, Name: body.Name });
