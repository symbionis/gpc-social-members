---
title: "Postmark parses Mustachio tags inside HTML comments (template create fails 1131/1122)"
date: 2026-07-09
category: integration-issues
module: email
problem_type: integration_issue
component: email_processing
symptoms:
  - "Postmark create/edit template fails with ErrorCode 1131: 'The layout content placeholder must not be present in a non-layout template.'"
  - "Postmark create/edit template fails with ErrorCode 1122: \"The 'HtmlBody' could not be parsed.\""
  - "The visible template markup looks correct — the offending syntax is inside an HTML comment"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [postmark, mustachio, email-templates, html-comments, template-creation, transactional-email]
related:
  - docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md
  - docs/solutions/integration-issues/postmark-mustachio-conditional-syntax.md
---

# Postmark parses Mustachio tags inside HTML comments

## Problem

Creating (or editing) a Postmark template via the API failed with a parse/validation error even though the *rendered* markup was fine. The culprit was Mustachio-looking syntax sitting inside an HTML comment — Postmark parses `{{ }}` tags **inside comments too**, so an authoring note that mentions template syntax becomes real (broken) template code.

## Symptoms

- `POST /templates` returns `422 { ErrorCode: 1131, Message: "The layout content placeholder must not be present in a non-layout template." }`
- After fixing that, `422 { ErrorCode: 1122, Message: "The 'HtmlBody' could not be parsed." }`
- The `<body>` markup renders correctly in preview; the only tags at fault are in an `<!-- ... -->` comment.

## What Didn't Work

- **Assuming HTML comments are inert.** The comment was documentation-only (a note describing the template's layout and Mustachio conventions). It was never meant to render, so it looked harmless. Postmark tokenizes the whole body, comments included.
- **Reading the error literally.** 1131 says "the layout content placeholder must not be present" — but the *body* had no `{{{@content}}}` in its markup. The placeholder was only in the comment text: `Renders inside the main-polo-club layout ({{{@content}}})`. Postmark saw a real content placeholder in a non-layout template and rejected it.
- **Fixing only the first error.** Removing `{{{@content}}}` surfaced 1122 next, from a *second* tag in the same comment: `Mustachio: no {{#if}} — use {{#key}}…{{/key}}`. The `{{#if}}` opened a section with no matching `{{/if}}` → unbalanced parse.

## Solution

Keep **all** template tags out of comments. Reword any authoring note so it contains no `{{`/`}}` sequences.

Before (comment breaks template creation):

```html
<!-- event-ticket: … Renders inside the main-polo-club layout ({{{@content}}}).
     Mustachio: no {{#if}} — use {{#key}}…{{/key}}; pass null (not "") to omit. -->
```

After (same intent, no tags):

```html
<!-- event-ticket: … Renders inside the main-polo-club layout. Mustachio
     conditionals use section tags (no if-blocks); pass null, not an empty
     string, to omit an optional block.
     NOTE: keep template tags out of comments — Postmark parses them here too. -->
```

Validate the render before trusting it — Postmark's `POST /templates/validate` reports `AllContentIsValid` plus per-field errors without sending. (Merged in PR #64; live template alias `event-ticket`.)

## Why This Works

Mustachio (Postmark's logic-less Mustache variant) tokenizes the entire body string for `{{ … }}` tags before it ever considers HTML structure — comments are not a parse boundary. So:

- `{{{@content}}}` in a comment is a genuine layout-content placeholder, illegal in a non-layout (Standard) template → **1131**.
- `{{#if}}` in a comment is a genuine section open with no close → unbalanced block → **1122**.

Removing the tag characters removes the tokens; the comment text stays as documentation.

## Prevention

- **No `{{`/`}}` in comments.** If a comment must reference syntax, describe it in prose ("section tags", "double braces") rather than writing the literal tag.
- **Create/update templates through a script that validates first.** `scripts/postmark/create-event-ticket-template.mjs` upserts the template from `docs/email-templates/*`; pair it with `POST /templates/validate` and a representative `TestRenderModel` to catch both parse errors (1122) and empty-field render bugs in one pass.
- **Test-render, don't just create.** A template can create successfully and still render fields blank — the sibling scoping trap (`{{event_title}}` inside `{{#inviter_name}}` renders empty; use `{{.}}` / `{{../}}`) is documented separately in [postmark-mustachio-dot-notation-in-block-scope.md](../integration-issues/postmark-mustachio-dot-notation-in-block-scope.md). Always validate with real data before shipping.

## Related Issues

- [Postmark Mustachio: Scoping Rules for Section Blocks](postmark-mustachio-dot-notation-in-block-scope.md) — render-time counterpart: `{{.}}` and `{{../}}` inside section blocks.
- [Postmark Mustachio: No `{{#if}}` — Use Scope Blocks](postmark-mustachio-conditional-syntax.md) — why `{{#if}}` is invalid (the same construct that triggered 1122 here).
