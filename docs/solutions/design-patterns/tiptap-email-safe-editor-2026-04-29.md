---
title: TipTap WYSIWYG configuration for email-safe HTML output
module: components/admin
date: 2026-04-29
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Building a rich-text composer whose output is rendered inside an email"
  - "Allowing internal users (admins) to author HTML that ships to recipients"
  - "Need preview rendering of authored HTML inside the same admin app"
related_components:
  - frontend_stimulus
  - email_processing
tags:
  - tiptap
  - rich-text
  - wysiwyg
  - email
  - xss-prevention
  - sandboxed-iframe
  - schema-restriction
---

# TipTap WYSIWYG configuration for email-safe HTML output

## Context

A rich-text editor that drives email body content has constraints a general-purpose editor does not:

- **Email clients vary wildly.** Code blocks, blockquotes, horizontal rules, base64-embedded images, and CSS classes render unpredictably (or not at all). Markup that's "valid HTML" can collapse the layout in Outlook.
- **Authored content is stored and re-rendered.** The same HTML the editor produces is later (a) sent through the email provider, and (b) shown back to the admin in a preview / detail view. Both paths need defence against unsafe URLs without forcing server-side sanitisation.
- **Most TipTap defaults assume a CMS context.** They lean expressive — code blocks, tables, embedded videos. For email you want the opposite: a small allowlist of formats that render everywhere.

## Guidance

Configure TipTap with three layers of restriction: schema-level disabling, URL allowlists on link/image, and sandboxed iframe for any rendering of the authored HTML.

### 1. Disable email-incompatible features at the schema level (not just the toolbar)

Hiding a button is not enough — paste from another rich-text source can still inject schema nodes the editor accepts. Disable at the StarterKit configuration:

```ts
StarterKit.configure({
  heading: { levels: [1, 2, 3] },   // explicit allowlist for heading levels
  codeBlock: false,
  blockquote: false,
  horizontalRule: false,
}),
```

Even if the toolbar exposes only paragraph/heading/list/link/bold/italic, a paste containing a `<pre><code>` block is rejected because the schema node doesn't exist. This is the only durable defence.

### 2. Allowlist URL schemes on Link (and Image, if used)

TipTap's Link extension accepts arbitrary `href` values by default — including `javascript:`, `data:`, and `vbscript:`. Provide a `validate` function that rejects anything outside an allowlist:

```ts
function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:|tel:|\/|#)/i.test(url.trim());
}

Link.configure({
  openOnClick: false,
  HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
  validate: isSafeUrl,
}),
```

Mirror the same check at the toolbar's link-insert handler — `validate` only fires for the schema, not for user input that's about to be passed to `setLink({ href })`. Also alert the user when the URL is rejected, otherwise the click does nothing and feels broken.

The same pattern applies if you re-add Image: validate `https?://` only, reject everything else.

### 3. Render authored HTML inside a sandboxed iframe (preview + detail)

The same admin who authors a broadcast also views past broadcasts in a detail page. Even though only `super_admin` can author, it's defence in depth — a malicious paste or a future role expansion shouldn't pivot into a stored XSS on the admin UI.

```tsx
const bodyDoc = `<!DOCTYPE html><html><head>...</head><body>${broadcast.body_html}</body></html>`;

<iframe
  title="Broadcast body"
  srcDoc={bodyDoc}
  sandbox=""                                  // no-flags = maximally restrictive
  className="rounded-xl border w-full min-h-[400px]"
/>
```

`sandbox=""` (empty string) blocks scripts, top-level navigation, and same-origin access. The iframe still renders HTML, so formatting (bold, lists, links, images) shows correctly. Avoid React's raw-HTML escape hatch — it's flagged by security review hooks and bypasses the sandbox. Sandboxed iframe is the right tool for showing authored HTML back to the user.

### 4. Disable `allowBase64` on the Image extension if/when you re-enable images

```ts
Image.configure({
  HTMLAttributes: { style: "max-width: 100%; height: auto; display: block; margin: 16px 0;" },
  allowBase64: false,  // base64 inflates body size and many spam filters dislike data URIs
}),
```

Inline `max-width: 100%` keeps any image — regardless of source dimensions — within the 600px email frame.

### 5. Keep the toolbar minimal

A maximalist toolbar invites users to use email-incompatible formatting. Stick to: paragraph, H1, H2, H3, bold, italic, bullet/ordered list, link. That's enough for almost every member communication. Nothing else makes sense in email.

## Why This Matters

- **Preview ≠ delivered render.** Postmark's renderer, the recipient's mail client, and your in-app iframe all paint the same HTML differently. Restricting authored markup to a small allowlist of widely-supported tags is the only way to keep previews trustworthy.
- **XSS via authored content is a stored vulnerability.** The body is persisted to a DB row and re-rendered every time someone opens the broadcast detail. Linting on the client at insert time isn't enough; the schema-level constraints + iframe sandboxing are.
- **Future role expansion is a real risk.** v1 limits author rights to super_admin, but plenty of similar features get loosened to "team admins" later. Building the safety in from day one means that change is a one-line role-gate update, not a sanitisation overhaul.

## When to Apply

- Any rich-text → email body pipeline.
- Any rich-text composer whose output is stored and re-rendered to other internal users.
- Any feature where the sender of authored content has different trust level than the viewer (admin → admin, team-member → admin, etc.).

## Examples

**Inserting a link with validation:**

```tsx
function setLink() {
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Link URL", previous ?? "https://");
  if (url === null) return;
  if (url === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  if (!isSafeUrl(url)) {
    window.alert("Only http(s):, mailto:, tel:, and relative URLs are allowed.");
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}
```

The `isSafeUrl` check is duplicated between this handler and the `Link.configure({ validate })` call — that's intentional: the handler protects against invalid URLs being attempted at all (better UX), the validate guards against schema-level injection from paste.

## Related Docs

- `docs/solutions/ui-bugs/email-button-text-color-email-client-rendering.md` — sibling reminder that email clients render HTML inconsistently.
- `docs/plans/2026-04-29-001-feat-postmark-broadcasts-admin-page-plan.md` — plan that introduced the editor.
- `docs/plans/2026-04-29-002-feat-broadcast-image-upload-plan.md` — pending image upload plan; references this pattern for safe image insertion.
