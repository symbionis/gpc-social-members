---
title: "A content hash attests to the text, not to how it was presented or how consent was signalled"
date: 2026-08-11
category: architecture-patterns
module: events
problem_type: architecture_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A record stamps a content-derived version (hash, checksum, revision) of a legal or policy document at the moment of acceptance"
  - "The same document is rendered by more than one component, route, or surface"
  - "Different surfaces gate consent with different gestures — an explicit affirmation on one, a plain button tap on another"
  - "A shared text module exists but each consumer wraps it in its own chrome, language set, or confirmation UI"
  - "An orphaned component still renders a legal document after its only consumer was deleted"
symptoms:
  - "Every acceptance row carries the same version while the surfaces that produced them differed in chrome, language, and consent gesture"
  - "The record cannot answer which surface the person saw or what gesture they made"
  - "One path requires an explicit \"I have read and accept\" tick; another treats a button tap as acceptance"
  - "A deleted feature leaves behind an unused renderer of a legal document that still looks safe to revive"
root_cause: inadequate_documentation
resolution_type: code_fix
related_components:
  - database
  - documentation
tags:
  - waiver
  - consent
  - content-hash
  - audit-trail
  - single-source-component
  - door-console
  - legal-record
---

# A content hash attests to the text, not to how it was presented or how consent was signalled

## Context

Event door check-in records a liability waiver on the ticket row. The version stamped against each acceptance is not hand-maintained — `lib/events/waiver.ts:193` derives it:

```ts
export function computeWaiverVersion(
  waivers: Record<WaiverLanguage, Waiver>
): string {
  const orderedLangs: WaiverLanguage[] = ["en", "fr"];
  const canonical = orderedLangs.map((l) => JSON.stringify(waivers[l])).join("|");
  return `open-doors-2026-${fnv1aHex(canonical)}`;
}

export const WAIVER_VERSION = computeWaiverVersion(WAIVERS);
```

The header comment at `lib/events/waiver.ts:14-16` states the intent plainly: the version is "DERIVED from a hash of the content below, not hand-maintained, so editing any clause necessarily changes the version recorded against each acceptance — the audit can never silently point a stale version at changed text." That property holds. It is also the whole of what the hash buys.

Every write path stamps that constant server-side and refuses a client-supplied value: `lib/events/checkin.ts:92` on the roster path, `app/api/public/door/[id]/check-in/route.ts:112` on the scan path, `app/api/public/bookings/[token]/waiver/route.ts:133` on the guest manage page. The clause text itself has one renderer, `components/events/WaiverText.tsx:9`, whose comment claims the shared body means "the exact same text — and therefore the same WAIVER_VERSION — is shown wherever a guest accepts it."

But the app had three *presentations* wrapped around that one body, all stamping the same version:

1. `components/door/ScanCheckIn.tsx` — the QR-scan phase, with bilingual chrome from its own local `WAIVER_COPY` const and an explicit "I have read and accept the waiver above" checkbox gating the submit button.
2. The door roster row's inline block, later extracted as `DoorWaiverModal` — English-only chrome, no checkbox at all. The button tap *was* the acceptance.
3. `components/common/WaiverConsentModal.tsx` *(deleted by PR #117 — it will not resolve in the current tree)* — orphaned since PR #92 deleted its only consumer, `ForwardedTickets.tsx`, and worse, it rendered the waiver clauses itself instead of using the shared `WaiverText`.

The divergence predated the extraction. The roster row's inline block was already English-only and checkbox-less before anyone pulled it into a component; nobody introduced this in a single bad commit. It accreted — two surfaces built at different times for different jobs, each locally reasonable, converging on the same database column.

So the stored `waiver_version` attested to the TEXT but not to the PRESENTATION. What language the guest read the instructions in, and what gesture counted as consent, depended on which surface admitted them, and nothing in the record said which.

## Guidance

**A version derived from content attests to content only.** If the record has to answer "what did this person agree to, *and how did they signal it*", a content hash answers half the question and looks like it answered all of it.

Given that, you have two honest options:

- **Single-source the presentation**, so there is only one answer to "how was it shown" and the content hash is sufficient by construction. This is almost always cheaper.
- **Capture the presentation in the record** — a surface identifier, a consent-mode flag, the chrome language distinct from the document language. This is the option you take when the surfaces genuinely must differ (a kiosk vs. an emailed link), and it means schema and backfill.

In this codebase the first was the right call. `components/events/WaiverModal.tsx` is now the single modal, and its header comment (`components/events/WaiverModal.tsx:9-18`) carries the reasoning forward rather than leaving it in a PR thread: "Since the recorded version is a hash of the waiver DATA, it cannot tell you what the guest saw or how they consented... One component is the only way that stays true." All three call sites raise it — `components/door/ScanCheckIn.tsx:244`, `components/door/DoorConsole.tsx:743`, `components/public/TicketManager.tsx:600` — and the shared `WaiverAcceptance` type (`components/events/WaiverModal.tsx:52`) is what each of them hands back, so a new surface cannot quietly define its own consent payload.

The second structural move is smaller and does more than it looks: **make the affirmation its own act rather than overloading a button that also performs the action.** The roster path's problem was not only that it lacked a checkbox — it was that the same tap meant both "I accept" and "check this person in", so the two are indistinguishable in the outcome. `components/events/WaiverModal.tsx:171-181` separates them, and the comment says why: "A tap on a phone being passed between people is easy to make by accident; ticking this is not." The button is then gated on `!accepted` at line 194.

Where the doc genuinely cannot be re-presented — a pre-signed waiver arriving at the gate — the rule is *never re-stamp*. `lib/events/checkin.ts:82` gates on `needsWaiver = attendee.waiver_accepted_at == null` and line 90 says "Sign now only if not already signed — never clobber an early self-reg signature." The manage-page endpoint mirrors it at `app/api/public/bookings/[token]/waiver/route.ts:123-128`: "Re-signing would silently move a guest onto a version they may never have read." Re-stamping is the same failure in the time dimension — attaching a version to a person who never saw that rendering.

Merge status, as of writing: PR #117 is merged to main. The consolidation onto a single `WaiverModal` and the guest-page pre-signing route described here are on PRs #121 and #122, which are **open, not shipped** — treat the single-modal state as pending until they land. #122 is stacked on #121 (its base is `feat/one-waiver-modal`, not `main`), so it cannot land first.

## Why This Matters

This class of divergence is invisible to every check you would normally run.

Every surface renders the same clauses, from the same `WaiverText` component, hashing to the same `WAIVER_VERSION`. Open any of them and the legal document is identical. Diff the stored rows and they agree. Read the tests — `lib/events/waiver.test.ts` asserts the version is stable and that editing a clause changes it, both of which pass and neither of which is about the thing that broke. The divergence lives entirely in the chrome and the gesture, which is exactly the part the recorded version has no vocabulary for. There is nothing to notice.

It only surfaces when someone asks a question the record was assumed to answer — a guest disputes that they consented, and the honest answer is "they accepted version `open-doors-2026-<hash>`, and depending on which door surface admitted them, that either means they ticked a bilingual affirmation or means they tapped a button labelled in a language they may not read." The record cannot narrow it further.

The second-order point is about the orphan. **An unused renderer of a legal document is worse than an unused RPC**, because reviving it looks safe. A dead RPC has an obvious blast radius and someone will read it before wiring it up. `WaiverConsentModal.tsx` looked like a working, tested modal named for exactly the job — the next person needing a waiver prompt on a new surface would have reached for it, and would have shipped a fourth presentation, one that renders its own copy of the clauses and so can drift from `WAIVER_VERSION` outright rather than merely diverging around it. Deleting it was the fix. There is no "leave it, it's harmless" for a component whose only purpose is to obtain legally-recorded consent.

## When to Apply

Four shapes should trigger this check:

- **A legal or consent document whose acceptance is recorded with a version.** Waivers, ToS, privacy consent, medical release, age attestation. The moment a version column exists, someone will later treat it as the full answer to "what did they agree to".
- **Any content-derived version hash.** The derivation is a good idea — it closes the stale-version hole. It also creates the illusion of completeness. Ask what the hash *does not* cover before relying on it, and write that boundary into the comment next to it, as `lib/events/waiver.ts:18-24` does.
- **A second renderer of anything whose acceptance is recorded.** Not a second *copy of the text* — a second *renderer*. The text being shared is what makes the divergence invisible; it is not what makes it safe.
- **A component named for one surface being reached for by another.** `DoorWaiverModal` used by a public guest page, or `WaiverConsentModal` (named for nothing in particular) used by the door. The name signals the presentation was designed for a context, and the new context is not that one. Either the name is wrong and the component is genuinely general — in which case rename it, as `DoorWaiverModal` → `components/events/WaiverModal.tsx` — or the component is not general and you are about to fork the presentation.

## Examples

**What the hash covers, and what it does not.** `lib/events/waiver.ts:193-201` serializes both languages in a fixed order and hashes the result:

```ts
const canonical = orderedLangs.map((l) => JSON.stringify(waivers[l])).join("|");
return `open-doors-2026-${fnv1aHex(canonical)}`;
```

The input is `WAIVERS` — titles, intros, clause headings, paragraphs, bullets. Nothing about the button label, the surrounding instructions, whether a checkbox exists, or which language the chrome was in. Every one of those is part of what a guest experienced as "signing the waiver", and none of them moves the hash.

**Before — two divergent acceptance gestures, one version.**

`ScanCheckIn.tsx` held its own `WAIVER_COPY` const with `en`/`fr` entries and gated its submit on an explicit affirmation ("I have read and accept the waiver above"). The roster row's inline block, on the same event, for the same document, had English-only chrome and no checkbox — tapping the check-in button was the acceptance. Both wrote `waiver_version = WAIVER_VERSION`.

**After — one component, one gesture.** `components/door/ScanCheckIn.tsx:18-20` now says what used to be there and why it left:

```
// The guest-facing waiver copy that used to live here moved into WaiverModal, which the
// roster path renders too — one component, so the two door surfaces cannot present the same
// legal document differently.
```

and its call site at `components/door/ScanCheckIn.tsx:240-243` states the invariant at the point where it could next be broken: "Two presentations of a legal document agreed on the text but had already diverged on the chrome and the acceptance gesture, and the recorded `WAIVER_VERSION` cannot tell them apart."

The affirmation and the action are now distinct (`components/events/WaiverModal.tsx:173-198`):

```tsx
<label className="flex cursor-pointer items-start gap-3">
  <input type="checkbox" checked={accepted}
    onChange={(e) => setAccepted(e.target.checked)} ... />
  <span ...>{t.accept}</span>
</label>
...
<button type="button"
  onClick={() => onAccept({ language, marketingConsent })}
  disabled={busy || !accepted} ...>
```

**The same class of problem, one level down: presentation state carrying across subjects.** Consolidating to one modal introduces a hazard the per-row inline block did not have — the modal outlives the guest. `components/events/WaiverModal.tsx:82-90`:

```tsx
// Reset every time it opens. Without this the affirmation carries: the clerk checks in one
// guest, opens the next, and the box is still ticked — admitting someone on a stranger's
// acceptance. The one piece of state in here that must never persist across guests.
useEffect(() => {
  if (!open) return;
  setLanguage(defaultLanguage);
  setAccepted(false);
  setMarketingConsent(true);
}, [open, defaultLanguage]);
```

A leftover tick would produce a `waiver_accepted_at` and a `waiver_version` on a ticket whose holder never saw the modal — and the record would look exactly like a valid acceptance. Same failure mode as the divergent surfaces: the stored version cannot express who was in front of the screen when the box was ticked, so the only defence is making it structurally impossible for the affirmation to belong to anyone but the current subject.

Note also that `guestName` is a required prop (`components/events/WaiverModal.tsx:67`, "Whose waiver this is — the clerk is working a queue, not a single person"), which is the same concern handled on the display side: the person accepting should be able to see whose acceptance they are making.

## Related

- [A registration-keyed door roster silently orphans any attendee without a registration](./registration-keyed-door-roster-orphans-imported-attendees.md) — the same shape one subsystem over: two functions named `buildDoorRoster`, drifting on orphan handling, under the rule "share it; do not restate it". There the duplicated thing was a filter and the failure was silent; here it was a presentation, and the failure was *masked* by an audit artefact that looked like it had covered the question.
- [Don't guard shared content as if it were entity-specific](../design-patterns/guard-shared-content-as-entity-specific-2026-05-21.md) — the same waiver file, from the opposite direction. That doc asks *whose* the content is; this one asks what the recorded version actually attests to. Its "one value, one place" rule is this rule one abstraction up: promoted from a duplicated value to a duplicated rendering.
- [Retiring a live flow: drop the write path, keep the history](../best-practices/retire-a-live-flow-drop-the-write-path-keep-the-history.md) — its step-5 orphan sweep is what missed `WaiverConsentModal` when PR #92 deleted the consumer. New rule that falls out: grep for the retired **component**, not only the retired route or noun, and treat an unimported component that renders legally operative content as a live defect rather than dead code.
- [A comment that justifies an omission is a load-bearing claim about another subsystem](../best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md) — same rot, opposite polarity. There a comment justified an absence; here `lib/events/waiver.ts` asserted a completeness ("the audit can never silently point a stale version at changed text") that is true of the clause text alone and reads as covering the acceptance. Its ladder applies unchanged: put the guarantee in a type or a test, because a hash cannot assert what it does not hash.

Shipped across PR #117 (deleted the orphan, merged), and PRs #121 and #122 (one modal for every surface; guest-page pre-signing) which are **open as of writing**.
