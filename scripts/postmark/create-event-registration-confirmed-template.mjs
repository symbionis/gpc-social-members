#!/usr/bin/env node
// Upsert the "event-registration-confirmed" Postmark template (the buyer's booking
// confirmation / itemised receipt, U13). The app never creates templates at runtime, so
// this must be run by someone with the server token to create it — or to push body changes.
//
//   POSTMARK_SERVER_TOKEN=xxxxxxxx node scripts/postmark/create-event-registration-confirmed-template.mjs
//
// Idempotent: creates the alias if missing, otherwise edits the existing template in place.
// Body is read from docs/email-templates/event-registration-confirmed.{html,txt}.

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
const htmlBody = readFileSync(join(templatesDir, "event-registration-confirmed.html"), "utf8");
const textBody = readFileSync(join(templatesDir, "event-registration-confirmed.txt"), "utf8");

const payload = {
  Name: "Event Registration",
  Alias: "event-registration-confirmed",
  Subject: "Geneva Polo Social Club - Event Registration",
  HtmlBody: htmlBody,
  TextBody: textBody,
  TemplateType: "Standard",
  LayoutTemplate: "main-polo-club",
};

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Postmark-Server-Token": token,
};

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
