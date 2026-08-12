#!/usr/bin/env node
// Upsert the two cancellation-notice Postmark templates (U5): "event-cancellation-holder"
// (sent to whoever's ticket was cancelled) and "event-cancellation-payer" (sent to whoever
// paid, when that's a different address). Run once by someone with the server token to
// create them — or to push body/subject changes.
//
//   POSTMARK_SERVER_TOKEN=xxxxxxxx node scripts/postmark/create-event-cancellation-templates.mjs
//
// Idempotent: creates each alias if missing, otherwise edits the existing template in place.
// Bodies are read from docs/email-templates/event-cancellation-{holder,payer}.{html,txt}.

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

const templates = [
  {
    Name: "Event Cancellation (Holder)",
    Alias: "event-cancellation-holder",
    Subject: "Your ticket for {{event_title}} is cancelled",
    file: "event-cancellation-holder",
  },
  {
    Name: "Event Cancellation (Payer)",
    Alias: "event-cancellation-payer",
    Subject: "A seat you booked for {{event_title}} was released",
    file: "event-cancellation-payer",
  },
];

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Postmark-Server-Token": token,
};

for (const t of templates) {
  const payload = {
    Name: t.Name,
    Alias: t.Alias,
    Subject: t.Subject,
    HtmlBody: readFileSync(join(templatesDir, `${t.file}.html`), "utf8"),
    TextBody: readFileSync(join(templatesDir, `${t.file}.txt`), "utf8"),
    TemplateType: "Standard",
    // Same layout chrome as the other event emails.
    LayoutTemplate: "main-polo-club",
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
    console.error(`Failed (${res.status}) for ${payload.Alias}:`, body);
    process.exit(1);
  }
  console.log(`${isUpdate ? "Updated" : "Created"} template:`, {
    TemplateId: body.TemplateId,
    Alias: body.Alias,
    Name: body.Name,
  });
}
