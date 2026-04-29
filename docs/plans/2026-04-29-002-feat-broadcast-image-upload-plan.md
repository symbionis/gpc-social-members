---
title: 'feat: image upload with server-side resize for broadcasts'
type: feat
status: active
date: 2026-04-29
---

# feat: image upload with server-side resize for broadcasts

## Overview

Add an image upload pipeline to the broadcast composer so admins can drop a photo into the rich-text editor without first hosting it elsewhere. Uploads are validated, resized, and stored in a public Supabase Storage bucket; the editor inserts the resulting public URL as an `<img>` element. Image-by-URL is deliberately NOT a feature in v1 of broadcasts (removed in the same iteration that removed the schema-level Image extension), so this plan introduces image handling for the first time on a clean slate.

The product goal is to remove the "find a hosted URL first" friction admins hit today, while keeping image bytes small enough to land cleanly in inboxes (~150–250 KB per image rather than the multi-MB raw exports a phone camera produces).

---

## Problem Frame

The broadcasts feature currently has no image support. Members of the GPC team who want to send a photo of an event, a partner offer card, or a fieldside hero shot must upload the asset to a third-party service (the GPC website, Imgur, Cloudinary, etc.), copy the URL back, and paste it. This is friction non-technical admins won't tolerate, and we know the club's voice is visual.

Constraints:
- Many email clients block external images by default — but when shown, oversized originals slow rendering and harm deliverability.
- Email body width is 600px; supplying a 4000×3000 phone photo is wasteful.
- Upload pipelines are a perennial security target — MIME spoofing, oversized payloads, server-side parser exploits.
- Supabase Storage already exists in the stack (used for `profile-photos`).

---

## Requirements Trace

- R1. Admins can insert an image into the broadcast composer via a file picker (drag-and-drop optional in v1).
- R2. Uploads are gated to `super_admin` and validated for MIME type and size.
- R3. The server resizes the uploaded image to a max width of 1200px (covers retina display at the 600px email frame), preserves aspect ratio, and re-encodes as JPEG quality 82 (or WebP if the original is WebP and the renderer can serve it as JPEG fallback for email clients that lack WebP support — defer to JPEG for v1).
- R4. The resulting asset is stored in a public Supabase Storage bucket and the composer receives a public URL that can be embedded in HTML email.
- R5. The TipTap editor inserts an `<img>` with `max-width: 100%; height: auto` attributes so the image cannot blow out the 600px email frame on any client.
- R6. Failed uploads (oversized, wrong MIME, server error) surface a clear inline message in the composer.
- R7. The image lives in a path scoped to a broadcast or to the admin who uploaded it, so accidental name collisions cannot overwrite a different admin's image.
- R8. The pipeline is reusable: if a future admin surface wants image upload (e.g. event hero images, member benefits artwork), the same endpoint and storage bucket can serve it.

---

## Scope Boundaries

- No drag-and-drop in v1. File picker only. Drag-and-drop is a TipTap extension on top.
- No image cropping or focal-point selection. The admin uploads the image they want; the server only resizes proportionally.
- No animated GIF support — resize loses the animation. Reject GIF MIME at the upload boundary.
- No automatic alt-text generation. Admin enters alt text after the image is inserted (or it stays empty — accessibility nag in the UI but not a hard block).
- No image library or asset reuse view. Each upload is fire-and-forget; the URL goes into the broadcast body and that's it. A future "media library" admin page is its own scope.
- No image deletion on broadcast delete. The asset is small and orphaned uploads are negligible at this scale; revisit if storage cost grows.

### Deferred to Follow-Up Work

- Drag-and-drop and paste-from-clipboard support: separate plan.
- Media library admin page (browse / reuse / delete uploaded images): separate plan.
- AVIF / WebP serving with JPEG fallback for older email clients: requires content negotiation; defer.
- Reuse of the same upload endpoint by event hero images: code is reusable, but the wiring on the events admin page is a separate piece of work.

---

## Context & Research

### Relevant Code and Patterns

- `components/member/ProfileForm.tsx:75-108` — existing client-side upload pattern: `supabase.storage.from('profile-photos').upload(...)` then `getPublicUrl(...)`. This is direct browser → Supabase, no server resize. Good template for the upload step but does not match our requirement to resize.
- `app/api/admin/events/create/route.ts` and `/update/route.ts` — pattern for super_admin-gated admin API routes that accept JSON bodies. Image upload differs in that it accepts multipart form data, but the auth gate pattern is the same.
- `lib/broadcast/channels/email-postmark.ts` — adapter that consumes `body_html` containing `<img>` tags. No changes needed here; the editor produces standard HTML.
- `components/admin/RichTextEditor.tsx` — TipTap editor. Currently configured WITHOUT the Image extension after the v1 broadcasts iteration. Reintroduce `@tiptap/extension-image` (already removed via `npm uninstall`) plus a custom uploader handler.
- `lib/supabase/admin.ts` — service-role client. The upload route uses this to bypass RLS for the storage bucket.

### Institutional Learnings

- `feedback_sdk_lazy_init.md` — third-party clients must be lazily initialised (no module-scope `new Sharp(...)` or `new ServerClient(...)`). Sharp is a singleton-style dependency but its constructor is lazy by nature; just don't pre-instantiate in module scope.
- `feedback_railway_nextjs_env.md` — Railway env vars must exist before the build. `sharp` is a native binary; Next.js standalone bundles it correctly on Linux, but verify it does not get tree-shaken out.

### External References

- `sharp` — the de facto Node image library. Resize, re-encode, strip EXIF, all in a few lines. Native binaries shipped for darwin-arm64 (local dev) and linux-x64 (Railway production).
- Supabase Storage docs — public buckets, MIME enforcement, file path rules.
- OWASP File Upload Cheat Sheet — MIME validation must inspect bytes, not just the `Content-Type` header. `sharp` itself fails closed on non-image input, which is our final defence.

---

## Key Technical Decisions

- **Server-side resize with sharp, not client-side compression**: client compression saves upload bandwidth but admins are uploading from desktops with fast WiFi; the bigger wins (consistent output size, EXIF strip, format normalisation) come from the server. Single source of truth keeps the email-friendly contract on the server.
- **Resize to max-width 1200px JPEG quality 82**: 1200px is 2× the 600px email frame, covering high-DPI clients. JPEG q82 is the sweet spot for photographs (the dominant content type for a polo club). Smaller images stay at their original size; we never upscale.
- **Public Supabase Storage bucket `broadcast-images`**: emails are sent to recipients on the open internet; signed URLs would expire and break the email after a few hours. Public read with no listing is the standard pattern for this use case.
- **Filename strategy `<admin_id>/<uuid>.<ext>`**: avoids collisions, attributes the upload, easy to clean up per-admin if ever needed. UUID prevents URL-guessing for unrelated assets.
- **Multipart upload to a Next.js API route, not direct browser → Supabase**: we need to run sharp between receive and store. Direct browser upload bypasses the resize. Route accepts `multipart/form-data`, validates auth + MIME + size, pipes through sharp, writes to Supabase via service role.
- **MIME allowlist: image/jpeg, image/png, image/webp**: covers the realistic admin upload cases. GIF is rejected at the boundary because resize loses animation. SVG is rejected because of XML-injection class issues in email clients.
- **Size cap: 10 MB pre-resize, ~250 KB post-resize**: 10 MB is the realistic upper bound for an iPhone HEIC export converted to JPEG; resize will compress most photos to under 250 KB. If post-resize is still over 1 MB, log a warning so we can tune the quality level.
- **EXIF strip on every upload**: privacy + size win. `sharp` does this with a single `.withMetadata({})`-style call (or by default — verify).
- **Reuse-friendly route name `/api/admin/uploads/image`**: not nested under `broadcasts` so future admin surfaces (events, member portal, partner artwork) can call the same endpoint without code duplication. Body or query param can carry a `purpose` string for telemetry.

---

## Open Questions

### Resolved During Planning

- **Where does the resize run — client, edge, or server?** Server. Single source of truth, easier to evolve, no reliance on user device CPU.
- **Public or signed URLs?** Public. Email recipients cannot refresh signed URLs.
- **Should we strip EXIF?** Yes — privacy (location data) and size win.
- **Who has upload rights in v1?** super_admin only. Same role gate as broadcast send.
- **Reuse for other admin surfaces?** Endpoint is generic. Wiring beyond the broadcast composer is a follow-up.

### Deferred to Implementation

- Whether to detect "too small to be useful" (e.g. < 200px wide) and warn vs. accept. Decide while testing.
- Whether to record the upload in a DB row for auditing, or rely solely on Supabase Storage object listing. Probably no DB row in v1 unless cleanup needs one.
- Exact JPEG quality value (78? 82? 86?) — start at 82 and adjust based on a test send.

---

## Output Structure

    app/api/admin/uploads/image/
      route.ts                              # POST — multipart receive, sharp resize, supabase upload, return URL

    components/admin/
      RichTextEditor.tsx                    # MODIFY — re-add Image extension; add file-picker handler that calls the upload route

    lib/broadcast/                          # (unchanged)
    docs/plans/                             # (this plan)

    Supabase Storage bucket: broadcast-images   (public read, no listing, MIME allowlist enforced server-side)

---

## High-Level Technical Design

> *Directional sketch for review; not implementation specification.*

```
[admin clicks Image button]
        │
        ▼
[hidden <input type=file> opens]
        │ user selects file
        ▼
┌─────────────────────────────┐
│ RichTextEditor component    │
│  POST /api/admin/uploads/   │
│       image                 │
│  multipart: file=<blob>     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ /api/admin/uploads/image    │
│  1. super_admin gate        │
│  2. parse multipart         │
│  3. validate MIME + size    │
│  4. sharp                   │
│     .resize({ width: 1200,  │
│              fit: inside }) │
│     .jpeg({ quality: 82 })  │
│     .withMetadata({})       │
│  5. supabase.storage        │
│     .from('broadcast-images')│
│     .upload(path, bytes)    │
│  6. getPublicUrl(path)      │
│  7. return { url }          │
└──────────────┬──────────────┘
               │
               ▼
[editor.chain().setImage({src})]
```

---

## Implementation Units

- U1. **Supabase Storage bucket setup**

**Goal:** Create the `broadcast-images` bucket with public read and a server-side MIME allowlist, mirroring the existing `profile-photos` setup.

**Requirements:** R4, R7

**Dependencies:** None

**Files:**
- Migration via Supabase MCP (no migration file in repo)

**Approach:**
- Create bucket `broadcast-images` (public, no listing).
- Set CORS to allow GET from any origin (for inboxed emails) and POST from production + Railway preview hosts (for the admin upload).
- File size limit at the bucket level: 12 MB (a small buffer above our 10 MB pre-resize cap).
- MIME enforcement at the bucket level for jpeg/png/webp.

**Patterns to follow:**
- Existing `profile-photos` bucket configuration.

**Test scenarios:**
- Test expectation: none — pure infra. Verified by U2 integration.

**Verification:**
- Bucket visible in Supabase dashboard, public read confirmed by hitting any random object URL after a manual upload.

---

- U2. **Upload API route**

**Goal:** Build `POST /api/admin/uploads/image` that accepts a multipart upload, validates and resizes via sharp, writes to Supabase Storage, and returns a public URL.

**Requirements:** R2, R3, R4, R6, R7

**Dependencies:** U1

**Files:**
- Create: `app/api/admin/uploads/image/route.ts`
- Modify: `package.json` (add `sharp`)

**Approach:**
- Auth gate: `super_admin` per `admin_users.role`. 401/403 on failure.
- Parse multipart via `request.formData()`. Read the `file` field as `Blob`/`File`.
- Validate MIME against allowlist `['image/jpeg', 'image/png', 'image/webp']`. Reject otherwise with 400.
- Validate raw size ≤ 10 MB (`file.size`). Reject with 413 if exceeded.
- Stream into sharp:
  - `.rotate()` (auto-rotate via EXIF orientation)
  - `.resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })`
  - `.jpeg({ quality: 82, mozjpeg: true })`
  - `.withMetadata({ exif: {} })` to strip EXIF
- Upload to Supabase via service-role client: path `<admin_id>/<crypto.randomUUID()>.jpg`.
- Return `{ url }` from `getPublicUrl`.
- On any error, log and return a 500 with a descriptive message (don't leak internals to non-super_admin paths since they're already gated, but keep the message admin-readable).

**Patterns to follow:**
- `app/api/admin/events/create/route.ts` for the auth gate.
- `components/member/ProfileForm.tsx:75-108` for the Supabase Storage `.upload(...)` + `.getPublicUrl(...)` pattern.

**Test scenarios:**
- Happy path: super_admin POSTs a 3 MB JPEG → 200, response carries a `url` field; URL fetches a JPEG ≤ 250 KB with EXIF stripped.
- Auth: unauthenticated → 401. Non-super_admin → 403.
- MIME rejection: PDF, GIF, SVG → 400 with "Unsupported image type".
- Size rejection: 12 MB JPEG → 413 with "File too large".
- Resize: 4000×3000 input → output max width 1200, aspect preserved.
- Upscaling: 400×300 input → output stays 400×300 (`withoutEnlargement: true`).
- Corrupt file: random bytes with `Content-Type: image/jpeg` → sharp throws → 400 with "Invalid image".
- EXIF strip: input with GPS coordinates → output has no GPS metadata.

**Verification:**
- Manual end-to-end test with a phone photo confirms file size dropped to under 250 KB and the asset is reachable at the returned public URL.

---

- U3. **TipTap image extension + composer wiring**

**Goal:** Re-add the TipTap Image extension and a file-picker button that uploads through `/api/admin/uploads/image` and inserts the returned URL.

**Requirements:** R1, R5

**Dependencies:** U2

**Files:**
- Modify: `components/admin/RichTextEditor.tsx`
- Modify: `package.json` (re-add `@tiptap/extension-image`)

**Approach:**
- Re-add `Image` extension with the same constraints as before:
  - `HTMLAttributes: { style: "max-width: 100%; height: auto; display: block; margin: 16px 0;" }`
  - `allowBase64: false`
- Add an `Image` toolbar button. Click opens a hidden `<input type="file" accept="image/jpeg,image/png,image/webp" />`.
- On file change: POST multipart to `/api/admin/uploads/image`. Show "Uploading…" state in the toolbar (disable other buttons, show a small spinner / text).
- On success: `editor.chain().focus().setImage({ src: url, alt: "" }).run()`. Optionally prompt for alt text after insertion (can be inline via a toolbar that appears when an image is selected — defer this polish).
- On error: surface inline at the top of the editor area.
- Keep `isSafeImageUrl` validation as a defence-in-depth check before calling `setImage` (rejects anything that came back from the route with a non-https scheme).

**Patterns to follow:**
- The pre-removal toolbar Image button (see git history of `components/admin/RichTextEditor.tsx`).
- `components/member/ProfileForm.tsx` for the file-input ref pattern.

**Test scenarios:**
- Happy path (manual / e2e): admin clicks Image, picks a JPEG, sees an "Uploading…" state, then the image appears inline in the editor at a sensible width.
- File rejected by MIME: admin picks a PDF → toolbar shows "Unsupported image type" inline.
- File too large: admin picks a 15 MB photo → toolbar shows "File too large (max 10 MB)".
- Auth lost mid-session: route returns 401 → toolbar shows "Please log in again".
- Inserted image survives Preview: clicking Preview wraps the editor's HTML in the iframe and the image renders.
- Inserted image survives Send: real broadcast lands in the inbox with the image inline.

**Verification:**
- One real broadcast send with a single inserted image, opened in Gmail and Apple Mail, confirms the image renders without horizontal scroll on mobile width.

---

## System-Wide Impact

- **Interaction graph:** New API route added under `/api/admin/uploads/image`; new TipTap toolbar action. No existing routes change.
- **Error propagation:** API route fails closed (auth, MIME, size, sharp parse). Toolbar surfaces the error inline; no silent fallbacks.
- **State lifecycle risks:** An upload that succeeds at the storage layer but fails to return the URL would leave an orphaned object. Acceptable at v1 scale; document for follow-up cleanup if storage cost grows.
- **API surface parity:** None. New endpoint.
- **Integration coverage:** End-to-end manual smoke test required: upload a real phone photo → composer inserts → preview shows → real send delivers an inboxed email with the image visible.
- **Unchanged invariants:** Broadcast send pipeline (`lib/broadcast/*`) does not change. The body_html passed to Postmark stays untouched; the only difference is that `<img src="https://<supabase-storage-host>/...">` is now allowed to appear in it.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Malicious file disguised as an image (e.g. polyglot file) | sharp parses bytes, not the Content-Type header. If sharp cannot decode, reject. MIME allowlist on top is defence in depth. |
| Sharp native binary not present in Railway production build | Verified at deploy time; sharp ships prebuilt binaries for linux-x64 musl. If absent, build fails loudly. Document in PR description. |
| Public Supabase Storage object gets URL-guessed and exposed as a vector | Filenames use crypto.randomUUID() (122 bits of entropy). URLs are share-by-link, exactly the same trust model as Imgur and similar. |
| Email client blocks external images | Out of scope of this feature — the same risk exists for any image-bearing email. Best practice would be to encourage admins to write effective subject + first paragraph that work without images. |
| Storage cost grows over time | Negligible at current scale. Re-evaluate when broadcast-images bucket exceeds 1 GB. |
| Image with extreme aspect ratio (e.g. 5000×100 banner) renders awkwardly | Resize preserves aspect ratio with `fit: 'inside'`. Worst case the email looks weird but doesn't break. Editor preview will show it the same way. |

---

## Documentation / Operational Notes

- Sharp is a native dependency. Verify Railway build picks up the linux-x64 binary on first deploy after merge.
- The `broadcast-images` bucket is public-read. Document this in the project handoff so it isn't surprising during a security audit.
- Add `BROADCAST_IMAGES_BUCKET=broadcast-images` env var if we want to make the bucket name configurable; otherwise hardcode in the route.
- No new Postmark configuration needed — emails already render `<img>` tags from any URL the layout allows.

---

## Sources & References

- `components/member/ProfileForm.tsx:75-108` — existing Supabase Storage upload pattern.
- `components/admin/RichTextEditor.tsx` — TipTap editor (image extension previously removed).
- Sharp documentation — https://sharp.pixelplumbing.com/
- Supabase Storage documentation — public buckets, MIME enforcement.
