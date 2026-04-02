---
title: "Postmark Mustachio: No {{#if}} — Use Scope Blocks {{#key}}...{{/key}}"
date: 2026-03-31
category: integration-issues
component: email/postmark-templates
technologies: [Postmark, Mustachio, HTML email]
symptoms:
  - "Postmark template validation error: The path 'if originator_note' is not valid"
  - "A scope block was opened but not closed"
  - "Open and closing elements are mismatched"
  - Conditional block using {{#if}} or {{{#if}}} rejected by Postmark
related:
  - docs/solutions/integration-issues/postmark-mustachio-dot-notation-in-block-scope.md
---

# Postmark Mustachio: No `{{#if}}` — Use Scope Blocks

## Problem

When adding a conditional block to a Postmark email template using Handlebars-style `{{#if key}}...{{/if}}` or triple-brace `{{{#if}}}`, Postmark's template validator throws errors:

```
Line 21, character 3: The path 'if originator_note' is not valid.
Line 21, character 3: A scope block to the following path was opened but not closed: 'if originator_note'
Line 26, character 3: It appears that open and closing elements are mismatched.
```

## Root Cause

Postmark uses **Mustachio**, a logic-less Mustache variant. It has no `{{#if}}` helper — that syntax belongs to Handlebars. Mustachio has no conditional helpers at all. Conditionals are expressed through **scope blocks** that gate on property presence/truthiness.

## Solution

Replace `{{#if key}}...{{/if}}` with `{{#key}}...{{/key}}`:

### Before (broken — Handlebars syntax)
```handlebars
{{#if originator_note}}
<tr>
  <td>Note</td>
  <td>{{originator_note}}</td>
</tr>
{{/if}}
```

### Also broken (triple braces do not fix it)
```handlebars
{{{#if originator_note}}}
...
{{{/if}}}
```

### After (correct — Mustachio scope block)
```handlebars
{{#originator_note}}
<tr>
  <td>Note</td>
  <td>{{originator_note}}</td>
</tr>
{{/originator_note}}
```

The block renders when `originator_note` is non-null, non-empty, and non-false. It is skipped entirely otherwise.

## Mustachio Conditional Reference

| Syntax | Renders when |
|--------|-------------|
| `{{#key}}...{{/key}}` | `key` is truthy (non-null, non-empty, non-false) |
| `{{^key}}...{{/key}}` | `key` is falsy or absent |
| `{{key}}` | Output value (HTML-escaped) |
| `{{{key}}}` | Output value (unescaped HTML) |

**No `{{#if}}`, `{{else}}`, comparisons, or ternary expressions exist.**

## Critical: Pass `null`, Not `""`

Mustachio scope blocks evaluate as follows:

| Server passes | `{{#key}}` block |
|--------------|-----------------|
| `null` | Skipped ✓ |
| `undefined` / key absent | Skipped ✓ |
| `""` (empty string) | **Renders** ✗ |
| `false` | **Renders** ✗ (see related doc) |
| Any non-empty string | Renders ✓ |

Always pass `null` (not `""`) for absent optional template values:

```ts
// Wrong — empty string causes the block to render
originator_note: data.originatorNote || "",

// Correct — null causes the block to be skipped
originator_note: data.originatorNote || null,
```

## Prevention Checklist

- [ ] No `{{#if}}` or `{{else}}` in any Postmark template — use scope blocks only
- [ ] Optional fields pass `null` from the server, never `""`
- [ ] Template tested via Postmark preview with the optional field both present and absent
- [ ] Template model TypeScript type has optional string fields typed as `string | null`
