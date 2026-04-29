---
title: 'feat: Postmark Broadcasts admin page'
type: feat
status: active
date: 2026-04-29
---

# feat: Postmark Broadcasts admin page

## Overview

Build a `/admin/messages` page that lets administrators compose and send one-to-many broadcasts to segments of members (e.g. all active members, all expired members, members on a specific tier) using Postmark's Broadcast Streams. Persist broadcasts and per-recipient delivery records in Supabase. Wrap sending behind a thin channel adapter so additional channels (WhatsApp, SMS) can be added later without rewriting the page or the recipient resolver.

The product goal is to give admins a self-serve tool for ad-hoc member communications (event announcements, club news, partner offers) without engineering involvement, while keeping transactional flows (renewals, payments, event confirmations) on Postmark Transactional Streams as today.

---

## Problem Frame

There is currently no way for administrators to broadcast a message to members from inside the admin panel. Anything beyond per-member transactional emails (renewal, approval, etc.) requires engineering to write a script or to reach out individually. As the membership and event calendar grow, the club needs a lean tool for ad-hoc messages while preserving the transactional channel's deliverability reputation.

Constraints surfaced in conversation with the user:
- Use Postmark (already wired) rather than introducing Mailchimp.
- Keep the architecture channel-agnostic so WhatsApp can plug in later without re-engineering.
- Sender for all member-facing email is `social@genevapolo.com` (already verified, applied globally).
- Solution must be self-service for non-technical admins.

---

## Requirements Trace

- R1. Admins can compose a broadcast (subject + body) on top of the existing GPC email layout.
- R2. Admins can pick an audience by member status (`active`, `expired`, `all`) and optionally narrow by tier.
- R3. Admins can preview the rendered email for a sample recipient before sending.
- R4. Admins can send the broadcast (no scheduled sends in v1) and see a result summary (sent / skipped / failed counts).
- R5. Every broadcast is persisted with its content snapshot, audience filter, channel, sender, and timestamp; per-recipient delivery rows are persisted for auditing.
- R6. Members who have unsubscribed from marketing email are excluded from broadcasts; transactional emails are unaffected.
- R7. Postmark Broadcast Streams are used for marketing sends (separate from the transactional stream the rest of the app uses).
- R8. Sending is fronted by a `BroadcastChannel` interface so WhatsApp or SMS can be added by writing a new adapter, without touching the admin page or the audience resolver.
- R9. Only `super_admin` can send broadcasts in v1 (matches the current bar for high-blast-radius admin actions like bulk reactivation).
- R10. A simple history view lists past broadcasts (subject, audience, sent count, sent_at) for accountability.

---

## Scope Boundaries

- No scheduled / drafted / recurring sends in v1.
- No A/B testing or audience-segment merging beyond `status` + `tier` filters.
- No WhatsApp adapter implementation in this plan — the abstraction is in place but only the Postmark email adapter ships.
- No per-recipient personalisation tokens beyond `first_name` and `last_name` in v1.
- No integration with the existing `email_settings` cron framework — broadcasts are admin-triggered, not scheduled.

### Deferred to Follow-Up Work

- WhatsApp channel adapter: separate plan, reuses the same `broadcasts` table and audience resolver.
- Member-facing preferences page where members manage their own marketing consent (v1 just exposes the unsubscribe footer link).
- Scheduled / drafted sends.

---

## Context & Research

### Relevant Code and Patterns

- `lib/postmark.ts` — current Postmark client wrapper. Uses `sendEmailWithTemplate` against the default (transactional) stream. `MessageStream` parameter selects a different stream — broadcast adapter sets it to a marketing stream id.
- `lib/members/reactivation.ts` — recently introduced helper extracted from a route file; mirrors the layering this plan needs (route -> lib helper performing the fan-out).
- `app/(admin)/admin/email-templates/page.tsx` — pattern for `super_admin`-gated admin pages with Postmark API calls server-side.
- `components/admin/EventManager.tsx` — existing pattern for an admin compose-style form with preview-friendly state.
- `app/api/admin/members/bulk-reactivation-expired/route.ts` — existing pattern for bulk fan-out API routes that loop over a member set, return `{ sent, skipped, errors }`, and stamp DB rows for idempotency.
- `app/api/webhooks/stripe/route.ts` — pattern for signed-webhook handler with branched event-type processing; the unsubscribe webhook will follow the same shape.
- `types/database.ts` — Supabase-generated types; `MemberStatus` and `PaymentCaptureStatus` aliases must be re-appended after each regeneration (per `feedback_db_types_aliases.md`).

### Institutional Learnings

- `feedback_postmark_mustachio.md` — Postmark uses Mustachio templating: use `{{#key}}…{{/key}}`, never `{{#if}}`; pass `null` (not `""`) for absent optional values. Applies to any new template registered for broadcasts.
- `feedback_sdk_lazy_init.md` — Postmark and Stripe clients must be lazily instantiated (no module-scope `new ServerClient(...)`). The existing `getPostmarkClient()` already follows this; new adapter must too.
- `feedback_db_types_aliases.md` — re-append `MemberStatus` / `PaymentCaptureStatus` aliases after Supabase regen.

### External References

- Postmark Broadcast Streams: separate stream per server, suppression and List-Unsubscribe headers handled automatically. API uses the same `Email` and `EmailWithTemplate` endpoints with `MessageStream` set to the broadcast stream id. Batch send (`sendEmailBatchWithTemplates`) accepts up to 500 messages per call.
- Postmark Suppression API: `getSuppressions` / `createSuppressions` per stream. List-Unsubscribe webhook posts to a configured URL with the suppressed email.

---

## Key Technical Decisions

- **Use Postmark Broadcast Streams, not the transactional stream**: protects the transactional sender reputation and lets Postmark auto-inject the unsubscribe header. Broadcast stream id is `broadcast` (the GPC server's default broadcast stream); stored as `POSTMARK_BROADCAST_STREAM_ID=broadcast`.
- **Different From address for broadcasts**: per Postmark's deliverability guidance, broadcast traffic uses `"Geneva Polo Social Club" <juliette@genevapolo.com>` while transactional continues from `social@genevapolo.com`. `juliette@` is already a verified Sender Signature in Postmark so no domain work is needed. Stored as `POSTMARK_BROADCAST_FROM`.
- **Dedicated email layout for broadcasts**: a new `gpc-postmark-members-comms-layout` template inherits the existing GPC layout but inserts a "Member Only Communication" banner directly below the header. Visually anchors broadcasts as members-only and signals they are different from transactional emails. The transactional layout `gpc-postmark-layout` is unchanged.
- **TipTap as the WYSIWYG editor**: headless React rich-text editor with a small footprint, actively maintained, easy to constrain to email-safe formatting. Toolbar is intentionally minimal: bold, italic, paragraph, heading 2/3, bullet list, ordered list, link. Output is plain HTML compatible with Postmark Mustachio variables.
- **Postmark batch send best practices**: per the broadcast stream's Setup Instructions, batches go through `/email/batchWithTemplates` (up to 500 messages per call) and the adapter caps in-flight requests at 10 concurrent connections. For 60 members today this is theoretical; matters once the audience grows.
- **Channel adapter pattern over branching**: `interface BroadcastChannel { send(recipients, content): Promise<SendResult[]> }` with one implementation today (`PostmarkEmailChannel`). Future channels implement the same interface.
- **Audience resolver is channel-agnostic**: `resolveAudience(filter)` returns `Member[]` with `marketing_consent = true`. The same resolver feeds email today and would feed WhatsApp later.
- **Persist a content snapshot, not a template reference**: broadcasts table stores the resolved subject and body as sent. If the underlying template or layout changes later, the historical record is preserved.
- **Per-recipient row at send time**: `broadcast_recipients` records `(broadcast_id, member_id, status, error)`. Enables audit, debugging, and future retry logic without redesigning the schema.
- **Fan-out via Postmark batch API (up to 500 per call)**: minimises latency and Postmark API rate. The adapter chunks recipients internally.
- **Unsubscribe via Postmark webhook → flips `members.marketing_consent` to false**: single source of truth in our DB, no need to reconcile with Postmark suppressions on every send (the audience resolver simply filters on `marketing_consent`).
- **Default `marketing_consent` = true for all current members**: paid-up club members have a legitimate-interest basis for broadcast comms in this private-club context. Explicit opt-out via unsubscribe link satisfies CAN-SPAM / GDPR for this MVP. Membership terms/onboarding copy update is out of scope here but called out as documentation impact.
- **Route role gate at `super_admin`**: matches bulk-reactivation. Lower-privilege admins can be granted later if comms become a frequent activity.
- **No scheduled sends in v1**: avoids the need for cron infra (`runRenewalReminders` style) and a draft state. Easy to add later by introducing `status: 'scheduled'` with a `send_at` column.

---

## Open Questions

### Resolved During Planning

- **Channel adapter or per-route branching?** Adapter. Keeps the admin page and audience resolver channel-agnostic.
- **Sender address?** `social@genevapolo.com` (already global default; no override needed for broadcasts).
- **Per-recipient personalisation depth?** `first_name` + `last_name` for v1. More tokens add UI surface that v1 doesn't need.
- **How to identify the unsubscribe target?** Postmark's webhook payload includes the recipient email; we look up the member by email and set `marketing_consent = false`.
- **What happens if a member with `marketing_consent = false` is in the broadcast audience?** They are filtered out by the resolver; counted in the `skipped` total of the result summary so the admin sees what happened.
- **Broadcast From address?** `"Geneva Polo Social Club" <juliette@genevapolo.com>` — already verified in Postmark Sender Signatures, satisfies the Postmark recommendation to keep transactional and broadcast senders distinct.
- **Broadcast stream id?** `broadcast` (the GPC server's default broadcast stream).
- **WYSIWYG editor library?** TipTap with a minimal toolbar (bold, italic, paragraph, heading, list, link). Outputs HTML compatible with the email layout. Avoids hand-written HTML in the composer.
- **Email layout reuse vs new layout?** New `gpc-postmark-members-comms-layout` Postmark layout with a "Member Only Communication" banner below the header. Transactional layout remains `gpc-postmark-layout`.

### Deferred to Implementation

- Exact Postmark batch chunk size and retry behaviour on partial failures — implementer should observe the Postmark response shape and decide whether to record per-recipient errors atomically or record the broadcast row first then update.
- Whether to display a recipient preview (count + first 5 emails) before sending — UX polish, decide while building the page.
- Whether the compose form supports raw HTML, a curated subset of tags, or a tiny markdown shim — start with raw HTML inside the existing layout block; iterate after first real send.

---

## Output Structure

    app/(admin)/admin/messages/
      page.tsx                             # list past broadcasts + "New broadcast" button
      new/
        page.tsx                           # compose page
      [id]/
        page.tsx                           # broadcast detail (subject, audience, recipients, results)

    app/api/admin/broadcasts/
      send/route.ts                        # POST — create broadcast row + fan out via adapter
      preview/route.ts                     # POST — render preview HTML for a sample recipient

    app/api/webhooks/postmark-unsubscribe/
      route.ts                             # POST — Postmark broadcast unsubscribe webhook

    components/admin/
      BroadcastComposer.tsx                # form: subject, WYSIWYG body, audience picker, preview, send
      RichTextEditor.tsx                   # TipTap-based reusable editor
      BroadcastList.tsx                    # table of past broadcasts
      BroadcastDetail.tsx                  # detail view with recipient log

    lib/broadcast/
      types.ts                             # BroadcastChannel interface, AudienceFilter, BroadcastContent
      audience.ts                          # resolveAudience(filter) -> Member[]
      send.ts                              # high-level dispatch: create broadcast row, call adapter, record results
      channels/
        email-postmark.ts                  # PostmarkEmailChannel implementing BroadcastChannel

    docs/email-templates/
      gpc-postmark-members-comms-layout.html   # new layout with "Member Only Communication" banner
      members-comms-broadcast.html             # broadcast template wrapping {{subject}} + {{{body_html}}}
      members-comms-broadcast.txt              # plain-text fallback

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│  Admin composer  │───>│  /api/admin/     │───>│ lib/broadcast/send.ts│
│  (UI form)       │    │  broadcasts/send │    │  (orchestrator)      │
└──────────────────┘    └──────────────────┘    └─────────┬────────────┘
                                                          │
                              ┌───────────────────────────┴────────────┐
                              │                                        │
                              ▼                                        ▼
                  ┌────────────────────────┐               ┌────────────────────┐
                  │ resolveAudience(filter)│               │ broadcasts (insert)│
                  │  → Member[] with       │               │ broadcast_recip…   │
                  │    marketing_consent   │               │  (insert per row)  │
                  └─────────┬──────────────┘               └────────────────────┘
                            │
                            ▼
                  ┌────────────────────────┐
                  │ BroadcastChannel.send()│
                  │  PostmarkEmailChannel  │
                  │   (today)              │
                  │  WhatsAppChannel       │
                  │   (future, same iface) │
                  └─────────┬──────────────┘
                            │
                            ▼
                ┌──────────────────────────┐
                │  Postmark Broadcast API  │
                │  (batch, MessageStream=  │
                │   broadcast)             │
                └──────────────────────────┘

Unsubscribe path:
  Recipient clicks footer → Postmark records suppression
    → Postmark webhook POST → /api/webhooks/postmark-unsubscribe
    → members.marketing_consent = false (single source of truth)
```

The audience resolver and the dispatch orchestrator never reference Postmark or HTTP — they speak in `BroadcastChannel`, `AudienceFilter`, and `Member[]`. Adding a WhatsApp adapter is a single file in `lib/broadcast/channels/` plus a route-level channel selector.

---

## Implementation Units

- U1. **Schema and types**

**Goal:** Add the persistent storage for broadcasts, per-recipient delivery records, and member marketing consent.

**Requirements:** R5, R6, R10

**Dependencies:** None

**Files:**
- Migration via Supabase MCP (no migration file in repo per existing convention)
- Modify: `types/database.ts` (regenerate, then re-append `MemberStatus` / `PaymentCaptureStatus` aliases)

**Approach:**
- New `broadcasts` table: `id uuid pk`, `subject text`, `body_html text`, `audience_filter jsonb`, `channel text` (default `'email'`), `status text` (`'sending'|'sent'|'failed'`), `sent_at timestamptz`, `recipient_count int`, `skipped_count int`, `error_count int`, `created_by uuid` (admin id), `created_at timestamptz default now()`.
- New `broadcast_recipients` table: `id uuid pk`, `broadcast_id uuid fk → broadcasts on delete cascade`, `member_id uuid fk → members on delete set null`, `email text` (snapshot — survives member deletion), `status text` (`'sent'|'failed'|'skipped'`), `error text`, `provider_message_id text` (Postmark's `MessageID` for the row), `created_at timestamptz default now()`.
- Add `members.marketing_consent boolean not null default true`.
- Indexes: `broadcast_recipients (broadcast_id)`, `broadcast_recipients (member_id)`, `broadcasts (sent_at desc)`.

**Patterns to follow:**
- `event_registrations` schema for foreign key + cascade discipline.
- `payment_retry_tokens` for the small-table audit-log shape.

**Test scenarios:**
- Test expectation: none — pure migration. Verified by U2/U3/U4 integration scenarios writing and reading these tables.

**Verification:**
- `select * from broadcasts limit 0;` and `select * from broadcast_recipients limit 0;` succeed.
- `select marketing_consent from members limit 1;` returns `true` for all rows.
- `types/database.ts` compiles and includes the new columns; the two manual aliases are still present after regen.

---

- U2. **Channel adapter + Postmark email adapter**

**Goal:** Define the `BroadcastChannel` abstraction and implement a Postmark broadcast-stream adapter that batches sends and returns per-recipient results.

**Requirements:** R4, R7, R8

**Dependencies:** U1, U8

**Files:**
- Create: `lib/broadcast/types.ts`
- Create: `lib/broadcast/channels/email-postmark.ts`
- Modify: `.env.local.example` (add `POSTMARK_BROADCAST_STREAM_ID`)

**Approach:**
- `BroadcastChannel.send(recipients: BroadcastRecipient[], content: BroadcastContent): Promise<RecipientResult[]>` where `BroadcastRecipient = { member_id, email, first_name, last_name }`, `BroadcastContent = { subject, body_html, body_text? }`, `RecipientResult = { member_id, email, status: 'sent'|'failed', error?: string, provider_message_id?: string }`.
- `PostmarkEmailChannel` chunks recipients into batches of 500 (Postmark's API max) and calls `sendEmailBatchWithTemplates` with `MessageStream` set to `process.env.POSTMARK_BROADCAST_STREAM_ID` (= `broadcast`) and `From` set to `process.env.POSTMARK_BROADCAST_FROM` (= the juliette address).
- Each message uses the new `members-comms-broadcast` template alias (registered in Postmark as part of U8) with `{{subject}}`, `{{body_html}}`, `{{first_name}}`, `{{last_name}}` model fields.
- Caps in-flight Postmark requests at 10 concurrent connections per the broadcast stream's setup instructions. For v1 audience size (~60 members) this is one or two batches in series; the cap matters as the audience grows.
- Adapter flattens Postmark's batch response (`{ MessageID, ErrorCode, Message, To }`) into `RecipientResult[]`.
- Module-scope SDK init is forbidden (per `feedback_sdk_lazy_init.md`) — reuse `getPostmarkClient()`.

**Patterns to follow:**
- `lib/postmark.ts` lazy-client pattern.
- `lib/members/reactivation.ts` for the "result-shape, not throw" return convention.

**Test scenarios:**
- Happy path: adapter receives 3 recipients with valid emails → returns 3 results with `status: 'sent'` and `provider_message_id` populated. Verified by manual smoke send to a test address before the admin UI is wired up.
- Edge case: adapter receives 600 recipients → splits into two batches (500 + 100) and merges results. Manual test against Postmark sandbox or by injecting a fake Postmark client.
- Error path: Postmark returns `ErrorCode != 0` for one row in a batch → that recipient's result has `status: 'failed'` and `error` populated; other recipients in the same batch are unaffected.
- Edge case: `POSTMARK_BROADCAST_STREAM_ID` env var missing → adapter throws clearly at first call (not at module load).

**Verification:**
- A manual smoke send (one admin-triggered call to the adapter from a Node script or an internal route) delivers a real email from `social@genevapolo.com` via the broadcast stream and returns a successful `RecipientResult`.
- `MessageStream` shows the broadcast stream id in Postmark's activity view (not the transactional stream).

---

- U3. **Audience resolver and send orchestrator**

**Goal:** Translate an audience filter into a recipient list (respecting consent) and orchestrate end-to-end dispatch: persist the broadcast row, call the adapter, persist per-recipient results.

**Requirements:** R2, R4, R5, R6, R8

**Dependencies:** U1, U2

**Files:**
- Create: `lib/broadcast/audience.ts`
- Create: `lib/broadcast/send.ts`

**Approach:**
- `resolveAudience(filter: AudienceFilter): Promise<BroadcastRecipient[]>` queries `members` with `status` and optional `tier_id` filters, plus `marketing_consent = true`. Returns the typed recipient shape the adapter consumes.
- `sendBroadcast({ subject, body_html, filter, channel, created_by })` performs:
  1. Resolve audience.
  2. Insert `broadcasts` row with `status: 'sending'`, `recipient_count` set to resolved length.
  3. Call channel adapter with the recipients and content snapshot.
  4. Bulk-insert `broadcast_recipients` rows from the adapter's `RecipientResult[]`.
  5. Update `broadcasts` row with final `status`, `sent_at`, `error_count`.
- Returns the broadcast id + counts for the API route to relay to the UI.
- Channel selection in v1 is hard-coded to `PostmarkEmailChannel`, exposed as a small lookup so future channels register here.

**Patterns to follow:**
- `lib/cron/renewal-reminders.ts` for the loop-and-stamp pattern (though this version uses bulk insert, not per-row update, since it writes new rows not back-stamps).
- `app/api/admin/members/bulk-reactivation-expired/route.ts` for the result-summary shape.

**Test scenarios:**
- Happy path: audience filter `{ status: 'active' }` with 3 active members all consenting → resolver returns 3 recipients, broadcast row inserted with `recipient_count = 3`, 3 `broadcast_recipients` rows with `status: 'sent'`, broadcast row updated to `status: 'sent'`.
- Edge case: audience filter matches 0 members → resolver returns `[]`, orchestrator inserts a broadcast row with `status: 'sent'` and `recipient_count = 0`, no recipient rows, no adapter call.
- Consent filtering: 5 active members, 1 with `marketing_consent = false` → resolver returns 4, broadcast row records `recipient_count = 4` (the unconsented member is invisible — counted neither in sent nor skipped, since the resolver excludes them upstream of the adapter).
- Tier narrowing: filter `{ status: 'active', tier_id: <classic-id> }` returns only active classic members.
- Error path: adapter returns mixed results (some `'failed'`) → all results persisted to `broadcast_recipients` with their statuses; broadcast row's `error_count` reflects the failures; `status: 'sent'` (partial success) rather than `'failed'`.
- Error path: adapter throws → broadcast row updated to `status: 'failed'`; error logged; no recipient rows persisted (or partial, depending on when the throw happens — implementer decides whether to persist what we have or roll back).

**Verification:**
- A direct call to `sendBroadcast` from a node script with a tiny test audience produces the expected DB state and a real email delivered.
- `select count(*) from broadcast_recipients where broadcast_id = ?` matches `recipient_count` on the parent broadcast row (modulo failed-before-persist edge case).

---

- U4. **Send + preview API routes**

**Goal:** Expose `POST /api/admin/broadcasts/send` and `POST /api/admin/broadcasts/preview` with `super_admin` gating.

**Requirements:** R1, R3, R4, R9

**Dependencies:** U2, U3

**Files:**
- Create: `app/api/admin/broadcasts/send/route.ts`
- Create: `app/api/admin/broadcasts/preview/route.ts`

**Approach:**
- `send` route: validates auth + `super_admin` role (mirrors `bulk-reactivation-expired`). Validates body `{ subject, body_html, audience_filter, channel: 'email' }`. Calls `sendBroadcast`. Returns `{ broadcast_id, sent, skipped, errors }`.
- `preview` route: same auth gate. Validates body `{ subject, body_html, sample_member_id? }`. Resolves the sample (defaults to the calling admin if not supplied), renders the body with their `first_name` / `last_name` substituted, and returns `{ subject, html }`. The preview deliberately does not call Postmark — it's a server-side render of the same template variables for in-page display.
- Reuse existing layout HTML server-side (read from `docs/email-templates/gpc-postmark-layout.html` or a dedicated lib helper) for the preview render so the WYSIWYG approximates the real send. Document the small drift between preview HTML and Postmark-rendered HTML as a known limitation.

**Patterns to follow:**
- `app/api/admin/members/bulk-reactivation-expired/route.ts` — auth + `super_admin` gate, POST body parse, structured result return.
- `app/api/admin/applications/approve/route.ts` — for clear error-path branching on validation failures.

**Test scenarios:**
- Auth: unauthenticated request → 401; admin without `super_admin` role → 403; super_admin → 200.
- Happy path send: valid body with a small `{ status: 'expired' }` audience → 200, `{ sent: N, skipped: 0, errors: [] }`, broadcast row visible in DB.
- Happy path preview: valid body → 200 with rendered HTML containing the substituted `first_name`.
- Validation: missing `subject` → 400; invalid `audience_filter.status` → 400.
- Edge case preview: `sample_member_id` does not exist → 404 with clear error.

**Verification:**
- `curl` (or Playwright) hitting `/api/admin/broadcasts/send` with a logged-in super_admin cookie completes end-to-end and persists the broadcast.

---

- U5. **Compose admin page (`/admin/messages/new`)**

**Goal:** Build the admin-facing composer page with subject, body, audience picker, preview pane, and send action.

**Requirements:** R1, R2, R3, R4, R9

**Dependencies:** U4

**Files:**
- Create: `app/(admin)/admin/messages/page.tsx` (list — links to `new` and to detail pages)
- Create: `app/(admin)/admin/messages/new/page.tsx` (server component shell)
- Create: `components/admin/BroadcastComposer.tsx` (client component — form, WYSIWYG editor, preview, send)
- Create: `components/admin/RichTextEditor.tsx` (TipTap-based reusable editor with the agreed minimal toolbar)
- Modify: `components/admin/AdminSidebar.tsx` (add "Messages" entry, super_admin-only)
- Modify: `package.json` (add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`)

**Approach:**
- Server component checks `super_admin` and redirects otherwise (mirrors `app/(admin)/admin/email-templates/page.tsx`).
- `RichTextEditor.tsx` wraps TipTap with `StarterKit` (paragraph, heading, bold, italic, lists) plus the `Link` extension. Toolbar exposes: bold, italic, H2, H3, bullet list, ordered list, link (insert / remove). Output is HTML via `editor.getHTML()`. Configured to disable editor features that don't render reliably in email (code blocks, blockquotes, images) — keeps the output safe for the email layout. Editor styles match the GPC body font / colour so the composer approximates the rendered email.
- `BroadcastComposer.tsx` state: subject, body_html (from `RichTextEditor`), audience_filter (`status` + optional `tier_id`), preview HTML, sending state, result.
- Audience picker reuses tier list from props (passed in by the server component, same as `EventManager.tsx`).
- "Preview" button POSTs to `/api/admin/broadcasts/preview` and renders the returned HTML inside a sandboxed `<iframe srcdoc={...} />` to avoid CSS bleed from the admin shell. Preview wraps `body_html` in the new members-comms layout (banner included) so admins see exactly what recipients will see.
- "Send" button shows a confirm dialog with the resolved recipient count (computed on the server from the same audience filter — small extra endpoint or include in preview response).
- After successful send, redirect to `/admin/messages/{id}` (the detail page from U6) so the admin sees the result + recipient log.

**Patterns to follow:**
- `components/admin/EventManager.tsx` for compose-form layout, save/cancel button placement, and result toasts.
- `components/admin/AdminSidebar.tsx` events_admin block for super_admin-only entries.

**Test scenarios:**
- Happy path (manual / e2e): super_admin lands on the page, fills subject, types into the WYSIWYG editor (bold, list, link), picks `Active`, clicks Preview → preview iframe shows the members-comms layout with banner and the formatted body. Clicks Send → confirm dialog shows N recipients. Confirms → redirected to detail page showing `Sent: N, Skipped: 0`.
- Editor formatting: bold, italic, headings (H2/H3), bulleted and ordered lists, and links all round-trip through the editor → preview → real email correctly. Disallowed formatting (code blocks, images) is not present in the toolbar.
- Audience change: switching audience filter updates the recipient count shown in the confirm dialog.
- Permission: non-super_admin opening `/admin/messages/new` → redirected to dashboard.
- Empty audience: filter resolves to 0 → "Send" button disabled with helper text "No recipients match this audience".
- Empty body: subject filled but editor empty → "Send" button disabled with helper text.

**Verification:**
- Manual end-to-end click-through with a fake "(test)" recipient pool produces a real email and a populated detail page.

---

- U6. **Broadcast list + detail pages**

**Goal:** Show admins a history of past broadcasts with per-recipient delivery state.

**Requirements:** R10

**Dependencies:** U1, U5

**Files:**
- Modify: `app/(admin)/admin/messages/page.tsx` (table of past broadcasts — implemented alongside U5's shell)
- Create: `app/(admin)/admin/messages/[id]/page.tsx`
- Create: `components/admin/BroadcastList.tsx`
- Create: `components/admin/BroadcastDetail.tsx`

**Approach:**
- List page shows `subject`, `audience_filter` summarised ("All active members" / "Expired members" / "Classic tier — active"), `recipient_count`, `error_count`, `sent_at`, sortable by `sent_at desc`.
- Detail page shows the broadcast row + a paginated table of `broadcast_recipients` (`name`, `email`, `status`, `error`). 100 rows per page.
- Both pages are super_admin only and follow the existing redirect pattern.

**Patterns to follow:**
- `components/admin/AttendeeList.tsx` for the recipient table pattern.
- `components/admin/MemberList.tsx` for filter + pagination.

**Test scenarios:**
- Happy path: navigate to `/admin/messages` → see at least the broadcast(s) sent in U5's manual test.
- Detail: open a broadcast → see all recipients with statuses; failed rows show the error string.
- Empty: navigate before any broadcast exists → empty state with a prominent "New broadcast" CTA.

**Verification:**
- After running U5's send flow once, the list page lists that broadcast and the detail page enumerates the recipients.

---

- U7. **Postmark unsubscribe webhook**

**Goal:** Honour unsubscribe events by flipping `members.marketing_consent` to false so future broadcasts skip them.

**Requirements:** R6, R7

**Dependencies:** U1

**Files:**
- Create: `app/api/webhooks/postmark-unsubscribe/route.ts`
- Modify: Postmark dashboard (post-deploy step — register the webhook URL on the broadcast stream's "SubscriptionChange" hook; documented in this plan's Documentation Plan, not a code change)

**Approach:**
- Postmark SubscriptionChange webhook posts JSON: `{ Recipient, Origin, SuppressionReason, ChangedAt, MessageStream }`. Verify the request comes from Postmark via a shared-secret query param (`?token=...` matching `POSTMARK_WEBHOOK_TOKEN`) — Postmark does not sign these webhooks, so the secret-in-URL pattern is the documented mitigation.
- On `SuppressSending` events, set `members.marketing_consent = false` for the matching email. On `Reactivated` / re-subscribe events, set it back to `true`.
- Unknown email → log and 200 (no row to update; not retryable).
- Always return 200 on validated requests so Postmark does not retry.

**Patterns to follow:**
- `app/api/webhooks/stripe/route.ts` for the signed-webhook handler shape (signature verification, branched event-type handling, 200 ack discipline).

**Test scenarios:**
- Happy path: webhook payload with known member email and `SuppressSending` → 200, member's `marketing_consent` flips to false.
- Re-subscribe: webhook with `Reactivated` event → 200, `marketing_consent` flips to true.
- Auth: missing or wrong `?token=...` → 401 (do not process).
- Unknown email: payload references a non-existent member → 200 (no-op), logged.
- Replay: same payload twice → idempotent (second call is a no-op since the column is already false).

**Verification:**
- Manual: trigger a real unsubscribe from the test broadcast in U2 → Postmark fires the webhook → DB row updated → next broadcast resolved with that audience excludes the member.

---

- U8. **Members-comms email layout + Postmark template registration**

**Goal:** Create a dedicated email layout for member-facing broadcasts that visually distinguishes them from transactional emails, and register the broadcast template in Postmark.

**Requirements:** R1, R7

**Dependencies:** None (logically precedes U2 / U5 for end-to-end use, but is an independent piece of work and can be built in parallel)

**Files:**
- Create: `docs/email-templates/gpc-postmark-members-comms-layout.html`
- Create: `docs/email-templates/members-comms-broadcast.html`
- Create: `docs/email-templates/members-comms-broadcast.txt`

**Approach:**
- Layout (`gpc-postmark-members-comms-layout.html`) is a near-copy of `gpc-postmark-layout.html` with an added banner row directly below the existing header. Banner copy: "Member Only Communication". Styled subtly: muted background colour from the GPC palette, small caps text, single-line, sits between the logo header and the body content area.
- Layout's `mc:edit` body slot remains unchanged so the template renders the same `{{{@content}}}` block as the transactional layout — Postmark templates rendered with this layout slot in via `body_html`.
- Template (`members-comms-broadcast.html` + `.txt`) is a thin wrapper: `<h1>{{subject}}</h1>` then `{{{body_html}}}` (triple-stache to allow HTML from the WYSIWYG editor) then a closing line. The `.txt` version strips HTML and provides a plain-text fallback.
- Register both in Postmark dashboard:
  1. New layout: alias `members-comms-layout`, paste HTML.
  2. New template: alias `members-comms-broadcast`, link to the new layout, paste subject (`{{subject}}`), HTML body, and text body.
- Document the registration steps in this plan's commit message so anyone on staging can replicate.

**Patterns to follow:**
- `docs/email-templates/gpc-postmark-layout.html` for header structure and brand colours (Marine `#052938`, Cream `#f4f2ef`).
- `docs/email-templates/gpc-mailchimp-layout.html` recent commit for mobile-responsive table widths (`width:100%; max-width:600px`) — apply the same pattern to the new layout to avoid the fixed-600px overflow on mobile.
- `docs/email-templates/membership-reactivation.html` and `.txt` for the simple template-on-layout shape.

**Test scenarios:**
- Render the new template with a sample model (subject + a known body HTML containing bold, list, link) in Postmark's preview tab and confirm: banner appears below the header, formatting renders, footer unsubscribe link is auto-injected by Postmark broadcast stream.
- Mobile rendering: open the rendered email in a narrow viewport (mobile preview in Postmark) → no horizontal scroll, banner wraps gracefully.
- Plain-text version is non-empty and readable.

**Verification:**
- Postmark dashboard shows both the new layout and the new template active and linked.
- A test send (the manual smoke from U2) renders with the banner visible.

---

## System-Wide Impact

- **Interaction graph:** New admin route, new public webhook route, new sidebar entry. Audience resolver reads from `members`. No existing flow changes behaviour as a result of this plan; transactional emails continue using the transactional stream.
- **Error propagation:** Adapter and orchestrator return result shapes (no throws on per-recipient failures). The route surfaces aggregate counts; the detail page surfaces per-recipient errors.
- **State lifecycle risks:** A broadcast row is inserted before sending starts and updated after — partial failures are visible (`status: 'sent'` with `error_count > 0`). If the process dies between insert and update, the row stays at `status: 'sending'` and is detectable by a future cleanup query. Acceptable for v1; document as a known edge case.
- **API surface parity:** None. The send/preview routes are new; existing API surfaces are untouched.
- **Integration coverage:** Audience resolver + adapter + DB writes need at least one happy-path manual smoke test that exercises the full chain; per-layer mocks alone won't prove that the broadcast row counts match the recipients persisted.
- **Unchanged invariants:** Transactional sends (`lib/postmark.ts` `sendEmail`) continue to use the default transactional stream. Existing email templates and aliases are unchanged. Renewal cron, event registration emails, payment retry emails, and approval emails are unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Sending a broadcast accidentally to all members during testing | Confirm dialog showing recipient count + audience summary before send. Default audience is empty (admin must pick a status filter). All sends behind `super_admin` role. Suggest using a private "(test)" tier in Stripe / membership_tiers to isolate test recipients during development. |
| Postmark suppression list and DB `marketing_consent` drifting out of sync | Webhook is the only mutator from Postmark → DB. DB is the source of truth for the resolver. Drift is one-way (Postmark might suppress before our webhook fires; that recipient just gets one extra send before being filtered next time — acceptable). |
| Unsigned Postmark webhook (Postmark does not sign SubscriptionChange) | Shared secret in the webhook URL (`?token=...`) matched against `POSTMARK_WEBHOOK_TOKEN`. Documented as the standard mitigation in Postmark's own docs. |
| Body HTML accepting raw input could ship malformed or hostile markup | Restrict v1 to `super_admin` (trusted operator). Sanitisation is not in scope for v1; documented for follow-up if lower-privilege admins are ever granted send rights. |
| Postmark batch send hitting per-stream rate limits during a large blast | Adapter chunks at 500 (the API limit); membership is currently ~60 members so this is theoretical. Re-evaluate if active member count crosses ~5000. |
| Marketing consent default = true is a legal-judgment call | Acceptable for a private members club where members joined explicitly and accepted club communications via membership. Documented as a follow-up to update onboarding copy. Members can unsubscribe at any time (the default Postmark footer link). |

---

## Documentation Plan

- Update club onboarding / member terms text (out of code scope) to mention "we may send occasional club news to members" — confirms the legitimate-interest basis for default consent.
- Register the `members-comms-layout` layout and the `members-comms-broadcast` template in Postmark per U8. Both reference the broadcast stream id `broadcast`.
- Configure the broadcast stream's SubscriptionChange webhook to point at `https://social.genevapolo.com/api/webhooks/postmark-unsubscribe?token=<POSTMARK_WEBHOOK_TOKEN>`. `POSTMARK_WEBHOOK_TOKEN` is already configured in Railway.
- Add the following Railway env vars before merge:
  - `POSTMARK_BROADCAST_STREAM_ID=broadcast`
  - `POSTMARK_BROADCAST_FROM="Geneva Polo Social Club" <juliette@genevapolo.com>`
- Verify Postmark broadcast stream Setup Instructions are satisfied: custom return path on `genevapolo.com` (already verified at domain level), unsubscribe link injected automatically by Postmark, sends use the `members-comms-broadcast` template, adapter sticks to ≤ 10 concurrent connections.

---

## Sources & References

- Conversation context (2026-04-29): user requested a "message members" admin page, channel-agnostic for future WhatsApp, leaning on Postmark Broadcasts.
- Existing patterns: `lib/postmark.ts`, `lib/members/reactivation.ts`, `app/api/admin/members/bulk-reactivation-expired/route.ts`, `app/(admin)/admin/email-templates/page.tsx`, `app/api/webhooks/stripe/route.ts`.
- Memory: `feedback_postmark_mustachio.md`, `feedback_sdk_lazy_init.md`, `feedback_db_types_aliases.md`.
- External: Postmark Broadcast Streams documentation; Postmark SubscriptionChange webhook payload reference.
