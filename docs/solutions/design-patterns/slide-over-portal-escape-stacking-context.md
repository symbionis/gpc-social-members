---
title: Slide-over panels need a React portal when the trigger sits inside a sticky / transformed ancestor
date: 2026-05-04
category: design-patterns
module: components/public
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Building a modal, drawer, or slide-over whose panel uses position:fixed"
  - "The trigger button lives inside an ancestor that creates a new stacking context (position:sticky, transform, filter, will-change, contain, opacity<1)"
  - "The panel needs to overlay siblings that live outside the trigger's parent — page header, other side cards, navigation"
related_components:
  - frontend_stimulus
tags:
  - react
  - portal
  - modal
  - drawer
  - stacking-context
  - z-index
  - frontend
---

# Slide-over panels need a React portal when the trigger sits inside a sticky / transformed ancestor

## Context

A common pattern on detail pages: render a sticky right-hand "summary" card containing an action button, and have that button open a full-height slide-over (drawer) overlaying the whole page. The naive implementation places the drawer panel as a JSX sibling of the trigger, both rendered from the same client component.

This works fine when the component lives at the top of the page tree. It silently breaks the moment the component is wrapped in an ancestor that creates a new **stacking context** — `position: sticky`, `transform`, `filter`, `will-change: transform`, `contain: paint`, `opacity < 1`, and several others. Inside the new context, any `z-index` you set on the drawer competes only with siblings inside that context. It cannot rise above siblings *outside* the context — like a `z-10` page header that lives at the document root.

Symptoms when this happens:

- Drawer opens, but the page header / nav bar overlays its top edge.
- Clicking the close button does nothing (the overlay above is intercepting the click; the visual feedback that you "see" the X is misleading).
- Backdrop click-to-close may or may not work depending on which element renders last in DOM order.
- Behavior changes between viewports because sticky only activates above its `lg:` breakpoint.

The fix is `createPortal` to `document.body`. Drawers and modals that need to overlay everything always belong at the document root, not next to the trigger.

A secondary gotcha that often confuses the diagnosis: when a `<button>` contains an `<svg>` icon, the click target reported by the browser is sometimes the inner `<path>` element. React's synthetic event still bubbles to the button, but pointer-events on SVG children can interact oddly with stacking-context interception. Adding `pointer-events-none` to the inner SVG ensures the click always lands on the button itself — useful as a defensive measure when debugging "the button doesn't respond".

## Guidance

For any modal, drawer, slide-over, popover, or full-screen overlay built in React:

1. **Render the panel through `createPortal(panel, document.body)`** — never as a JSX sibling of the trigger. The trigger button stays in place; the overlay/panel mounts at the body root.
2. **Hydrate-safely**: gate the portal render on a `mounted` boolean set in `useEffect` so the SSR pass and initial CSR pass don't disagree about portal targets.
3. **Inside the panel, use unambiguously high z-indexes** (`z-[100]` backdrop, `z-[110]` panel) so they sit above any document-root header.
4. **Make icon-only buttons reliably clickable**: add `pointer-events-none` to inner SVGs so clicks land on the `<button>` instead of an SVG path.
5. **Don't trust hover styles to mean "clickable"** — hover state can render fine even when the click is being intercepted higher up the stacking tree. If the hover works but the click doesn't, the parent stacking context is the first place to look.

## Why This Matters

- **The bug is invisible in development**: trigger lives next to the panel, so JSX nesting feels right. Failure mode only appears when an ancestor — often added later for stickiness or transforms — creates a stacking context. Two unrelated PRs (one adds sticky, one adds the drawer) can each look correct in isolation and break in combination.
- **Portal is the canonical React solution**, not a workaround. `createPortal` exists precisely for overlays.
- **Z-index races don't fix it**: bumping the panel to `z-[9999]` won't help if its parent stacking context tops out at `z: auto`. The panel can only fight within its parent's context.
- **Cost is trivial**: one `useEffect`, one `createPortal` call. No layout reflow, no hydration mismatch when gated on `mounted`.

## When to Apply

- Any new drawer, modal, sheet, or popover that is meant to **overlay the whole viewport** rather than just float within a card.
- When refactoring a card to be `position: sticky` or to use `transform`, audit any modals/drawers triggered from within it.
- When a previously-working drawer "stops closing" or "appears under the nav" after unrelated layout changes — check for a new stacking context before fiddling with z-indexes.

Do **not** portal:

- Inline dropdowns or popovers that are intentionally scoped to a card's bounds.
- Tooltips on individual fields (CSS `position: absolute` inside the parent is usually correct).

## Examples

### Before — drawer trapped inside a sticky aside

```tsx
// Detail page
<aside className="lg:sticky lg:top-6">  {/* creates a stacking context on lg */}
  <RegistrationDrawer ... />            {/* trigger button + panel rendered here */}
</aside>
```

```tsx
// Drawer (broken — panel renders as JSX sibling)
return (
  <>
    <button onClick={() => setOpen(true)}>Register</button>
    {open && (
      <>
        <div className="fixed inset-0 bg-marine/40 z-40" onClick={close} />
        <aside className="fixed top-0 right-0 ... z-50">{form}</aside>
      </>
    )}
  </>
);
```

Result: at `lg`+, the sticky parent creates a stacking context. The `z-50` panel can't rise above the page's `z-10` header (which lives at the document root, in a *different* stacking context). The X button is visually present but clicks are intercepted by the header overlay.

### After — panel portaled to document.body

```tsx
"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

export default function RegistrationDrawer({ ... }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const drawer = open ? (
    <>
      <div className="fixed inset-0 bg-marine/40 z-[100]" onClick={() => setOpen(false)} />
      <div role="dialog" aria-modal="true" className="fixed top-0 right-0 ... z-[110]">
        <button type="button" onClick={() => setOpen(false)} aria-label="Close">
          <svg className="h-5 w-5 pointer-events-none" ...>...</svg>
        </button>
        {form}
      </div>
    </>
  ) : null;

  return (
    <>
      <button onClick={() => setOpen(true)}>Register</button>
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
```

Key details:

- `mounted` gate avoids `document is not defined` during SSR and prevents hydration mismatch on the first client render.
- `z-[100]` and `z-[110]` are arbitrary high values; they only need to beat any other portal-rendered overlay.
- `pointer-events-none` on the SVG inside the close button removes one common cause of "clicks register on the button visually but the icon eats them".

### Stacking-context triggers worth remembering

Any of these on an ancestor will trap `position:fixed` z-index battles unless you portal:

| CSS | Why it creates a stacking context |
|-----|-----------------------------------|
| `position: sticky` (and `relative`/`absolute` with `z-index ≠ auto`) | Explicit context |
| `transform: translate(...)` etc. | Implicit; common on animations |
| `filter`, `backdrop-filter` | Implicit |
| `will-change: transform` / `opacity` | Implicit |
| `contain: layout` / `paint` / `strict` | Implicit |
| `opacity < 1` | Implicit |
| `mix-blend-mode` other than `normal` | Implicit |

## Related

- [docs/solutions/design-patterns/tiptap-email-safe-editor-2026-04-29.md](./tiptap-email-safe-editor-2026-04-29.md) — another component-level frontend pattern in the same repo
