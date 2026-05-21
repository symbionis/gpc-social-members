---
title: "Postmark passthrough {{{body_html}}}: Mustachio won't re-render tags inside it, and the shared Layout must style TipTap output"
date: 2026-05-21
category: integration-issues
module: event-messaging
problem_type: integration_issue
component: email_processing
severity: medium
symptoms:
  - "`{{first_name}}`/`{{email}}` typed into the admin message body render literally instead of substituting"
  - "TipTap `<h3>` renders as a tiny uppercase eyebrow label, not a sub-heading"
  - "Bulleted/numbered lists render with no indentation and text detached from the bullet"
  - "List items are spread far apart in the delivered email"
root_cause: wrong_api
resolution_type: config_change
tags:
  - postmark
  - mustachio
  - tiptap
  - email-templates
  - body-html
  - passthrough-template
  - layout-css
  - rich-text
related:
  - docs/solutions/design-patterns/tiptap-email-safe-editor-2026-04-29.md
  - docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md
  - docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md
  - docs/solutions/tooling-decisions/postmark-broadcasts-setup-2026-04-29.md
---

# Postmark passthrough `{{{body_html}}}`: Mustachio won't re-render tags inside it, and the shared Layout must style TipTap output

## Problem

Admin-authored TipTap rich text sent as `body_html` through a Postmark *passthrough* template (the body is just `{{{body_html}}}`, wrapped by a shared Layout) had two distinct rendering failures: merge variables typed into the body rendered literally, and the shared Layout's CSS mis-styled the editor's headings and lists.

## Symptoms

- A `{{first_name}}` (or `{{email}}`) typed into the message body arrived in the delivered email as the literal text `{{first_name}}`, never the recipient's name. Confirmed via Postmark `POST /templates/validate` — the rendered HTML contained `{{first_name}}` verbatim.
- `<h3>` sub-headings rendered as tiny (13px) uppercase letter-spaced accent text, not headings.
- Bulleted/numbered lists had no indentation; list-item text sat detached from its bullet, and items were spread far apart.

## What Didn't Work

- **Assuming Mustachio re-renders tags inside an injected value.** Intuition says "it's a template, so `{{first_name}}` inside the body should resolve too." It does not — Mustachio is **single-pass**, and triple-stache `{{{body_html}}}` injects the value as **raw, un-re-parsed data**.
- **Assuming a finished-looking brand Layout already styles all rich-editor output.** The `main-polo-club` Layout looked complete, but its `h3` was repurposed as an "eyebrow" label, it had **zero `ul/ol/li` rules**, and its global `p { margin: 0 0 16px }` actively broke lists. The Layout had only ever been exercised by hand-built transactional templates (none using h2/h3 or lists), so the gaps were invisible until real editor HTML flowed through it.

## Solution

**Fix A — stop promising merge fields inside a passthrough body.** The composer (`components/admin/EventMessaging.tsx`) no longer advertises `{{first_name}}`/`{{email}}` as usable in the body; the hint now states the message sends as written. Greeting personalization still works *only* via the template's own `{{#first_name}}…{{/first_name}}` block (`lib/broadcast/channels/email-transactional.ts`), which operates on the model field in the template source — not on text the admin types into `body_html`. True per-recipient body personalization would require pre-rendering the body string per recipient before the send call; intentionally not done.

**Fix B — make the shared Layout style TipTap output** (`docs/email-templates/gpc-postmark-layout.html`, mirrored to the live `main-polo-club` Layout via the Postmark Templates API).

Before (the problem CSS):

```css
h3 {                 /* repurposed as an uppercase accent "eyebrow" */
  font-size: 13px; font-weight: 200; letter-spacing: 3px;
  text-transform: uppercase; color: #95CEE1;
}
/* no ul / ol / li rules at all */
p { margin: 0 0 16px; }
```

After:

```css
h3 {                 /* a real sub-heading */
  font-family: 'Poppins', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 17px; font-weight: 600; color: #052938;
  margin-top: 20px; margin-bottom: 6px; line-height: 1.4;
}

/* Lists in content */
ul, ol { margin: 0 0 16px; padding-left: 24px; font-size: 16px; line-height: 1.65; color: #333F48; }
li { margin-bottom: 6px; }
/* TipTap wraps each list item's content in <p>; strip its margin so the
   text aligns with the bullet and items don't gap apart. */
li p { margin: 0; }
```

**Verification technique:** before shipping a template or Layout change, render it via Postmark `POST /templates/validate` using the *actual* `TemplateModel` (here `{ subject, body_html, body_text, first_name, email }`) and inspect the returned HTML. This is what surfaced the literal `{{first_name}}` leak and confirmed the heading/list CSS. Then follow with one live test send. The Layout change was confirmed safe-additive (no transactional template used h2/h3; one used a `<ul>` and only improved).

## Why This Works

- **Mustachio is single-pass; triple-stache is raw injection.** `{{{body_html}}}` substitutes the model value into the output without re-parsing it. Any `{{…}}` *inside* `body_html` is never seen by the engine — it has already moved past that token when the value lands. Only fields referenced in the template *source* (e.g. the template's own `{{#first_name}}` greeting block) resolve.
- **TipTap emits `<li><p>…</p></li>`, and the global `p` margin leaked in.** With `p { margin-bottom: 16px }` applying inside list items, every bullet's text inherited a bottom gap, detaching it from the marker and ballooning inter-item spacing. `li p { margin: 0 }` neutralizes that one nested case while leaving normal paragraph spacing intact. (Email clients also block the Layout's `@import` web fonts, so Playfair headings fall back to Georgia — acceptable.)

## Prevention

- For **any Postmark passthrough body** (a `{{{body_html}}}`-style field carrying user/admin-authored content): never tell authors they can use merge fields inside the body — Mustachio won't substitute them. If per-recipient personalization is genuinely needed, pre-render the body string per recipient *before* the API call.
- When a shared Layout will render **rich-editor HTML**, give it explicit CSS for the full tag set the editor can emit — `h1/h2/h3`, `ul/ol/li`, `strong/em/a` — and specifically add `li p { margin: 0 }` for any editor (like TipTap) that wraps list-item content in `<p>`. Don't assume a Layout that looks complete covers tags its prior hand-built templates never used.
- Always **validate-render with the real `TemplateModel`** (`POST /templates/validate`) and do a live test send before shipping a template/Layout change — this catches both literal-merge-field leakage and CSS regressions that a code read won't.
- This `{{{body_html}}}` passthrough pattern is shared with the **member broadcast** channel (`lib/broadcast/channels/email-postmark.ts` + the `members-comms-broadcast` template / `members-comms-layout`), so the merge-field limitation applies there too. If you wire personalization or change list/heading styling, update both layouts.

## Related Issues

- [`tiptap-email-safe-editor-2026-04-29.md`](../design-patterns/tiptap-email-safe-editor-2026-04-29.md) — the authoring side of this same pipeline (how the TipTap editor is constrained to emit email-safe HTML). This doc is the delivery-side complement: how that HTML renders through the Postmark Layout.
- [`postmark-mustachio-conditional-syntax.md`](./postmark-mustachio-conditional-syntax.md) and [`postmark-mustachio-dot-notation-in-block-scope.md`](./postmark-mustachio-dot-notation-in-block-scope.md) — other Mustachio-quirk gotchas (no `{{#if}}`; scope/dot-notation). This doc adds a third facet: no recursion into raw-injected content.
- [`postmark-broadcasts-setup-2026-04-29.md`](../tooling-decisions/postmark-broadcasts-setup-2026-04-29.md) — the broadcast stream/sender/layout setup that the transactional event-message path mirrors on the transactional side.
