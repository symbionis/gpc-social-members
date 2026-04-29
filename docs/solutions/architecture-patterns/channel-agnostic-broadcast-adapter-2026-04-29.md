---
title: Channel-agnostic broadcast adapter pattern (single audience resolver, pluggable channels)
module: lib/broadcast
date: 2026-04-29
problem_type: architecture_pattern
component: email_processing
severity: medium
applies_when:
  - "Building a one-to-many message pipeline that may serve multiple channels (email today, WhatsApp / SMS / push tomorrow)"
  - "Multiple channels share audience selection logic but differ in delivery mechanism"
  - "Need to keep consent and audit logging in one place across all channels"
related_components:
  - background_job
  - database
tags:
  - architecture
  - adapter-pattern
  - broadcast
  - multi-channel
  - consent
  - audit-trail
---

# Channel-agnostic broadcast adapter pattern

## Context

When introducing a "send to many members" feature, the natural first cut is to inline everything for the channel you're shipping (email): query members, loop, call Postmark, log per-recipient state, done. This works for v1 and rots immediately when WhatsApp / SMS / push appear, because the audience selection + consent filtering + audit trail get duplicated per channel and inevitably drift.

The fix is cheap up-front: a tiny interface between *who to message* and *how to deliver*. One audience resolver, one orchestrator, one DB schema, N pluggable channel adapters.

## Guidance

Carve the broadcast pipeline along these seams:

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│  Composer / API  │───▶│   Orchestrator   │───▶│  Audience Resolver   │
│  (channel='email')│    │ (sendBroadcast)  │    │  (consent-filtered)  │
└──────────────────┘    └────────┬─────────┘    └──────────┬───────────┘
                                 │                         │
                                 ▼                         ▼
                       ┌──────────────────┐      ┌────────────────────┐
                       │ Channel Adapter  │      │ Persist broadcast  │
                       │ (pluggable)      │      │ + per-recipient    │
                       └──────────────────┘      │ delivery rows      │
                                                 └────────────────────┘
```

### 1. Define a thin `BroadcastChannel` interface

```ts
// lib/broadcast/types.ts
export interface BroadcastChannel {
  readonly key: "email";  // widen to a union as channels are added
  send(
    recipients: BroadcastRecipient[],
    content: BroadcastContent
  ): Promise<RecipientResult[]>;
}

export interface BroadcastRecipient {
  member_id: string;
  email: string;        // or `phone` etc. — channel-relevant fields only
  first_name: string;
  last_name: string;
}

export interface BroadcastContent {
  subject: string;
  body_html: string;
  body_text?: string;
}

export interface RecipientResult {
  member_id: string;
  email: string;
  status: "sent" | "failed";
  error?: string;
  provider_message_id?: string;
}
```

The interface is intentionally minimal. Every adapter's contract: take recipients + content, return per-recipient results. Adapters never throw on per-recipient failures — they return a result row with `status: 'failed'` so the orchestrator can persist a complete audit trail.

### 2. One audience resolver, channel-agnostic

```ts
// lib/broadcast/audience.ts
export async function resolveAudience(filter: AudienceFilter): Promise<{
  recipients: BroadcastRecipient[];
  skipped: number;
}> {
  // 1. Query members by status / tier
  // 2. Filter by marketing_consent = true
  // 3. Return both consenting recipients AND the count of in-scope members
  //    excluded by consent (for transparency in admin UI)
}
```

Crucial decisions:

- **Consent filter lives here**, not in the adapter. The resolver is the single choke point for "should this person receive marketing?" — no downstream code can accidentally email an unconsented member.
- **Returns `skipped` separately** so admin UI can show "Send to N members (M skipped — no consent)". Visibility prevents the silent-shrinkage failure mode.
- **Paginates** to bypass platform query caps (Supabase's 1000-row default). Silently truncating the audience is a subtle, high-impact bug.

### 3. Orchestrator owns the lifecycle

```ts
// lib/broadcast/send.ts
const CHANNELS: Record<string, BroadcastChannel> = {
  email: PostmarkEmailChannel,
  // whatsapp: TwilioWhatsAppChannel,   // future
};

export async function sendBroadcast(input: SendBroadcastInput) {
  const channel = CHANNELS[input.channel ?? "email"];
  const { recipients, skipped } = await resolveAudience(input.audience_filter);

  // 1. Insert broadcasts row with status='sending', recipient_count, skipped_count
  // 2. Call channel.send(recipients, content)
  // 3. Bulk-insert broadcast_recipients with per-row status/error/provider_id
  // 4. Update broadcasts row → status='sent' (or 'failed') + final counts
}
```

Important properties:

- **Failure modes write rows.** On adapter throw, persist a `failed` recipient row for every recipient before marking the broadcast `failed` and re-throwing. Future you trying to debug a broadcast where `recipient_count = 60, error_count = 60` and zero recipient rows is a bad time.
- **Every DB update is error-checked.** Discarding `error` from `update().eq()` is how broadcasts stay stuck in `status='sending'` forever after a transient outage.
- **Channel selection via lookup**, not branching. Adding WhatsApp is one new file in `lib/broadcast/channels/` plus one entry in `CHANNELS`.

### 4. Schema is channel-aware in name only

```sql
broadcasts (
  id, subject, body_html, audience_filter jsonb, channel text default 'email',
  status, sent_at, recipient_count, skipped_count, error_count,
  created_by, created_at
)

broadcast_recipients (
  id, broadcast_id, member_id, email,
  status, error, provider_message_id, created_at
)
```

A `channel` column rather than separate tables per channel. The recipient schema accepts a generic `email` column — for non-email channels, store the channel-relevant identifier here (e.g., phone number for WhatsApp). `provider_message_id` is whatever the channel's API hands back. This keeps the audit trail uniform across channels.

### 5. Transactional vs broadcast separation is enforced at the adapter, not the type

The Postmark email adapter explicitly sets `MessageStream: 'broadcast'` and `From: <broadcast-from>`. The transactional `lib/postmark.ts` `sendEmail` helper continues to use the default stream and the transactional `From`. Same provider, same SDK, but the channel adapter for broadcasts is the only code path that touches the broadcast stream.

## Why This Matters

- **Adding WhatsApp later is a one-day task instead of a re-architecture.** Build the WhatsApp adapter implementing `BroadcastChannel`. Audience resolver, orchestrator, DB schema, admin UI — all unchanged. Ship.
- **Consent compliance scales.** A new channel cannot accidentally bypass `marketing_consent` because the resolver is upstream of the adapter. Adding a member-facing preferences toggle for "WhatsApp opt-in" is the only schema change you need; the resolver-as-choke-point pattern absorbs it.
- **Audit trail is uniform.** Every channel's per-recipient delivery state lives in the same `broadcast_recipients` table, queryable the same way. No "which table do I look at to see if Andrea got the WhatsApp message?" debate.
- **Tests are easier.** The adapter is the only thing that hits a third-party API. The orchestrator + audience resolver are pure-DB and trivially testable. WhatsApp tests look identical to email tests.

## When to Apply

- One-to-many message features where additional channels are likely (newsletters, announcements, partner offers).
- Domains where consent / audit / segmentation are first-class concerns (marketing, regulated comms, member benefits).

## When NOT to Apply

- Genuinely single-channel features where multi-channel is improbable (e.g., a one-off "send a Slack message when X happens"). The adapter pattern's overhead isn't free; only adopt when there's a real second channel on the horizon.

## Examples

**File layout for the GPC implementation:**

```
lib/broadcast/
  types.ts                          # BroadcastChannel, BroadcastRecipient, etc.
  audience.ts                       # resolveAudience(filter) → recipients + skipped
  send.ts                           # sendBroadcast orchestrator + CHANNELS lookup
  channels/
    email-postmark.ts               # PostmarkEmailChannel implementing BroadcastChannel
    whatsapp-twilio.ts              # FUTURE — implements the same interface
```

**Adding a future WhatsApp channel:**

```ts
// lib/broadcast/channels/whatsapp-twilio.ts
import type { BroadcastChannel, BroadcastRecipient, RecipientResult } from "../types";

export const TwilioWhatsAppChannel: BroadcastChannel = {
  key: "whatsapp",  // widen the union in types.ts
  async send(recipients, content) {
    // Twilio API calls, return per-recipient results
  },
};

// lib/broadcast/send.ts
const CHANNELS = {
  email: PostmarkEmailChannel,
  whatsapp: TwilioWhatsAppChannel,  // <-- one-line addition
};
```

The orchestrator, resolver, schema, admin UI — none change.

## Related Docs

- `docs/solutions/tooling-decisions/postmark-broadcasts-setup-2026-04-29.md` — the email-channel-specific Postmark setup this pattern wraps.
- `docs/solutions/design-patterns/tiptap-email-safe-editor-2026-04-29.md` — the composer that feeds content into the orchestrator.
- `docs/plans/2026-04-29-001-feat-postmark-broadcasts-admin-page-plan.md` — full plan with U-IDs and test scenarios.
