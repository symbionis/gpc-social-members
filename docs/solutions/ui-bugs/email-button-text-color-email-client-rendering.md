---
title: "HTML Email: Button Text Color Overridden by Email Clients"
date: 2026-03-31
category: ui-bugs
component: email/postmark-templates
technologies: [Postmark, HTML email, CSS]
symptoms:
  - Button text is unreadable — dark text on dark background
  - Link inside button shows default blue or grey despite inline color style
  - Text color applies in browser preview but not in Gmail, Apple Mail, or Outlook
related:
  - docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md
---

# HTML Email: Button Text Color Overridden by Email Clients

## Problem

A dark background CTA button (`background-color: #052938`) with white text (`color: #ffffff`) rendered with unreadable dark/blue text in email clients. The `color` inline style was present but being overridden by email client link stylesheets.

## Root Cause

Email clients (Gmail, Outlook, Apple Mail, iOS Mail) inject their own global link styles — typically `color: #0000EE` or `color: blue` — and these override inline `color` declarations on `<a>` tags unless `!important` is used. Similarly, `text-decoration` is often forced to `underline`.

## Solution

Use the canonical button HTML already established by other templates in the project. Never write button HTML from scratch.

### Correct button HTML

```html
<a
  href="{{url}}"
  class="button"
  style="color: #FFFFFF !important; text-decoration: none; display: inline-block; background-color: #052938; border-radius: 3px; font-family: 'Poppins', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 500; letter-spacing: 1px; text-align: center; padding: 12px 32px; -webkit-text-size-adjust: none;"
>
  Button Label
</a>
```

### Key properties

| Property | Value | Why |
|----------|-------|-----|
| `color` | `#FFFFFF !important` | `!important` overrides email client global link styles |
| `text-decoration` | `none` | Removes underline injected by email clients |
| `-webkit-text-size-adjust` | `none` | Prevents iOS Mail from resizing/recolouring text |
| `font-family` | Poppins stack | Consistent with GPC brand across clients |
| `class="button"` | Present | Postmark layout may apply additional shared styles |

## Prevention

1. **Copy from existing templates** — every email template in this project already has a working button. Copy and change only `href` and label text.
2. **Never omit `!important`** on `color` — it is mandatory for dark-background buttons in HTML email.
3. **Test in multiple clients** — Postmark's preview renders one client at a time. Test Gmail web, Apple Mail, and Outlook before shipping a new template.
4. **All email styling is inline** — do not use `<style>` blocks or external CSS; most clients strip them.

## Reference templates

All existing templates in `docs/email-templates/` use this button pattern:
- `member-approved.html`
- `membership-renewal.html`
- `application-declined.html`
