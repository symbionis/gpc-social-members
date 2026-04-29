---
title: Postmark Broadcasts setup pattern (separate stream, distinct sender, unsubscribe wiring)
module: lib/broadcast
date: 2026-04-29
problem_type: tooling_decision
component: email_processing
severity: medium
applies_when:
  - "Sending one-to-many marketing or member communications via Postmark"
  - "Adding a new broadcast / newsletter / announcement feature on top of an existing transactional Postmark server"
  - "Need to honour CAN-SPAM / GDPR unsubscribe via Postmark's built-in mechanism"
related_components:
  - authentication
tags:
  - postmark
  - broadcasts
  - email
  - unsubscribe
  - webhooks
  - deliverability
---

# Postmark Broadcasts setup pattern

## Context

Adding broadcast capability to a project that already uses Postmark transactionally. Naive approach: keep using the same stream, same sender, same template patterns. This works briefly, then bites — broadcasts share the same deliverability reputation as receipts and password resets, Postmark rejects sends without an unsubscribe link, and the unsubscribe state is split between Postmark's suppression list and the application DB.

## Guidance

Broadcasts on Postmark are a distinct product from transactional, with five concrete configuration touchpoints. Each one has a default that's wrong for serious use; this doc captures what to do instead.

### 1. Use a separate Broadcast Stream, never the transactional stream

In Postmark dashboard → Servers → `<server>` → Message Streams, the **Default Broadcast Stream** has stream id `broadcast`. Set it on every send via `MessageStream: process.env.POSTMARK_BROADCAST_STREAM_ID`.

```ts
// lib/broadcast/channels/email-postmark.ts
const batch = chunk.map((r) => ({
  From: process.env.POSTMARK_BROADCAST_FROM!,
  To: r.email,
  TemplateAlias: "members-comms-broadcast",
  TemplateModel: { /* ... */ },
  MessageStream: process.env.POSTMARK_BROADCAST_STREAM_ID!, // = "broadcast"
}));
await client.sendEmailBatchWithTemplates(batch);
```

This isolates the marketing reputation from transactional and gives you per-stream Activity / Suppressions / Webhooks configuration in Postmark.

### 2. Use a different `From` address from transactional

Postmark's own deliverability guidance: send broadcast from a different mailbox than transactional, ideally on the same verified domain. Two reputations, separate scoring at the recipient ISP.

In our case: transactional from `social@genevapolo.com`, broadcasts from `juliette@genevapolo.com` (already a verified Sender Signature, so zero new DNS work). Stored as a separate env var `POSTMARK_BROADCAST_FROM` so the channel adapter never accidentally borrows the transactional `From`.

### 3. Include `{{{pm:unsubscribe}}}` explicitly in the layout

Postmark requires broadcasts to contain an unsubscribe link, otherwise it auto-appends a default footer. The default is functional but visually inconsistent with the rest of the email. Place the merge tag explicitly in the layout footer where you control the styling:

```html
<p style="margin-top: 16px; font-size: 12px; color: #8B99A8;">
  You are receiving this email as a member of the Geneva Polo Social Club.<br />
  <a href="{{{pm:unsubscribe}}}" style="color: #8B99A8; text-decoration: underline;">
    Unsubscribe from member communications
  </a>
</p>
```

Important: triple-stache `{{{pm:unsubscribe}}}` so Postmark's URL substitution isn't HTML-escaped. **Postmark's preview tab does not substitute this merge tag** — the link appears empty in preview but works in real broadcast-stream sends. Test by sending a real email through `MessageStream: 'broadcast'` and clicking the link.

### 4. Wire the SubscriptionChange webhook to mutate your own consent column

Postmark fires a SubscriptionChange webhook when a recipient unsubscribes (footer link, list-unsubscribe header, manual suppression). Configure it on the Broadcast Stream's Webhooks tab — not the server-level webhooks — so it only fires for marketing events:

```
URL: https://<production-domain>/api/webhooks/postmark-unsubscribe?token=<POSTMARK_WEBHOOK_TOKEN>
Events: ✅ Subscription Change (only)
```

In our handler:

- **Token-gated, constant-time compared.** Postmark does not sign these webhooks; the documented mitigation is a shared secret in the URL. Use `crypto.timingSafeEqual` rather than `!==`.
- **Return 5xx on internal failures, 200 on application-level no-ops.** A DB lookup or update failure must return 500 so Postmark retries (its delivery is durable). Unknown email or malformed payload returns 200 since it's not retryable.
- **Honour `SuppressSending=true` only.** Don't auto re-enable consent on Postmark reactivation — re-subscription should require explicit member action via the application UI, not a side-effect of an admin clicking "un-suppress" in the Postmark dashboard.
- **DB column is the source of truth.** The audience resolver reads `marketing_consent` from your `members` table; the webhook is the only mutator from Postmark's side. Keeps your DB authoritative and avoids drift between Postmark's suppression list and your app state.

### 5. Stick to the documented batch limits

Postmark's broadcast stream Setup Instructions say: use `/email/batchWithTemplates` (up to 500 messages per call) and stay at ≤ 10 concurrent connections. The adapter chunks at 500 and serialises batches:

```ts
for (let i = 0; i < recipients.length; i += POSTMARK_BATCH_LIMIT) {
  const chunk = recipients.slice(i, i + POSTMARK_BATCH_LIMIT);
  // wrap each chunk in try/catch so a failing batch
  // does not lose the audit log for previously-sent batches
  try {
    const responses = await client.sendEmailBatchWithTemplates(batch);
    // map index → result, persist per-recipient log
  } catch (err) {
    // mark only this chunk's recipients as failed; previous chunks succeeded
  }
}
```

For audiences under ~5000 the latency impact is negligible.

## Why This Matters

- **Transactional deliverability is load-bearing.** Renewal emails not arriving is a revenue-blocker. Broadcasts mixed into the transactional stream pull the reputation down with every "Mark as spam" on a club news email.
- **Compliance hinges on the unsubscribe being honoured.** Postmark's suppression list alone isn't enough — your application's audience resolver also needs to filter. Without the webhook → DB column flow, you'll keep emailing members who opted out, which is a CAN-SPAM/CASL/GDPR violation.
- **Setup is one-time but the consequences last forever.** A wrong stream id baked into deployed code is hard to migrate later because past sends are tied to that stream's identity. Get it right at the start.

## When to Apply

- Any time you're adding broadcast / marketing / announcement email to a Postmark-using project.
- Reusing this pattern for other marketing channels (e.g. SMS via Twilio) — the **separate sender + explicit unsubscribe + webhook-mutates-DB-column** triad generalises.

## Related Docs

- `docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md` — Postmark templating quirks (`{{#key}}…{{/key}}` not `{{#if}}`).
- `docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md` — more Mustachio gotchas.
- `docs/plans/2026-04-29-001-feat-postmark-broadcasts-admin-page-plan.md` — full plan for the broadcasts admin feature this pattern came from.
