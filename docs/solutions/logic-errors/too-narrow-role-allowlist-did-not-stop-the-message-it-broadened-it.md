---
title: "A too-narrow role allow-list did not stop the message — it broadened it"
date: "2026-08-22"
category: "logic-errors"
module: "broadcasts"
problem_type: "logic_error"
component: "authentication"
symptoms:
  - "Manage Event -> Messages renders \"Not authorized\" for a team_admin on page load, before any action is taken"
  - "The Send button is disabled from load and never enables; nothing the admin types or changes produces a more diagnostic error"
  - "The mount-time recipient-count POST to /api/admin/events/[id]/messages/preview 403s, so recipientCount stays null and computeCanSend never returns true"
  - "Blocked from the event-scoped tool, the admin drafts the thank-you on the general member Messages page, aiming an event follow-up at every active member instead of the event's attendees"
root_cause: "missing_permission"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "broadcasts"
  - "events"
  - "admin-roles"
  - "event-messaging-ui"
tags:
  - "authorization"
  - "role-allowlist"
  - "team-admin"
  - "event-messaging"
  - "stale-comment"
  - "disabled-ui"
  - "audience-targeting"
  - "workaround-risk"
---

# A too-narrow role allow-list did not stop the message — it broadened it

## Problem

A `team_admin` (`sponsoring@genevapolo.com`) opened Manage Event → Messages, saw "Not authorized", and found the Send button permanently disabled before typing a character. `requireEventsAdmin` in `lib/broadcast/event-auth.ts` gated event messaging to `events_admin` and `super_admin` only, held in place by a code comment that **described a sibling module's behaviour** — that member-wide broadcasts were `super_admin` only. That was true the day it was written and false eleven days later, and nobody noticed for two and a half months. Blocked from the event-scoped tool, the admin fell back to the general Messages page and composed a post-event thank-you as a **member-wide broadcast**, aimed at every active member rather than the people who actually attended. It was caught before sending.

Fixed in PR #143 (merged 2026-08-20, reachable from the current tree). The comment shipped in PR #27 on 2026-05-21, was invalidated on 2026-06-01, and survived until 2026-08-20.

## Symptoms

- Manage Event → Messages renders "Not authorized" on load, with no user action taken.
- The Send button is disabled forever; its label reads a bare "Send" rather than "Send to N recipients".
- No recipient count ever appears — the counter line stays blank after "Counting recipients…".
- Nothing the admin does (switching audience, typing a subject, writing a body) improves the error or produces a more diagnostic message.
- The role in `admin_users` is `team_admin`, who can otherwise edit the event, refund tickets, resend confirmations, and broadcast to the entire membership.

## What Didn't Work

There was no failed fix attempt — the failure mode here is that **the user routed around the block**, which is worse than a failed fix because it produces no signal at all.

The workaround was to compose the message on the general Messages page (`app/(admin)/admin/messages/new/page.tsx` → `components/admin/BroadcastComposer.tsx`). That page is structurally incapable of addressing an event. Its payload carries an `AudienceFilter` (`lib/broadcast/types.ts:9-16`):

```ts
export interface AudienceFilter {
  status: MemberStatus | "all";
  tier_ids?: string[] | null;
}
```

`BroadcastComposer.tsx` builds exactly that shape at lines 79, 104, and 166 — `audience_filter: { status, tier_ids: tierIds }` — and `resolveAudience` in `lib/broadcast/audience.ts` translates it by querying the `members` table on `status` and `tier_id` alone. There is no `event_id` in the filter, no join to registrations, no notion of attendance.

The resulting draft (per this session's DB check, not source: broadcast `9e63b41d-6c2d-49e8-9b6d-1446ee810d2e`, subject "Thank You for Joining Us at Just Breathe", `audience_filter: {"status":"active","tier_ids":[]}`, `event_id: null`) was therefore addressed to **every active member**, not to attendees of the Breath & Polo event (`429d6c31-4ec7-4635-a8bc-3a0100ce679c`, 19 Aug 2026). Had it sent it would have thanked the whole membership for an evening most of them did not attend, and — because event audiences include door guests who exist in no member table — would have missed attendees who came as guests rather than members.

Contrast the correct resolver, `resolveEventAudience` in `lib/broadcast/event-audience.ts:65`: it reads `event_registrations` (line 114) for `event_pre`, and `tickets` with `.not("checked_in_at", "is", null)` (lines 143-146) for `event_post`. Only that path knows who was actually there.

## Solution

Add `team_admin` to the allow-list, and replace the comment that caused the exclusion.

**Before** (`lib/broadcast/event-auth.ts`, as shipped in PR #27 — this text no longer exists in the tree, do not grep for it):

```ts
/** Roles allowed to send event messages. Broader than member broadcasts
 *  (super_admin only) because event admins run the Manage Event page. */
const ALLOWED_ROLES = ["events_admin", "super_admin"];
```

**After** (`lib/broadcast/event-auth.ts:4-10`, current):

```ts
/** Roles allowed to send event messages. Mirrors requireBroadcastAdmin's
 *  allow-list (super_admin, team_admin) plus events_admin, who runs the
 *  Manage Event page but has no reason to touch member-wide broadcasts. A
 *  team_admin who can already send to the whole membership from the general
 *  Messages page must not be narrower here, or they're pushed into that
 *  broader tool for what should be an event-scoped message. */
const ALLOWED_ROLES = ["events_admin", "team_admin", "super_admin"];
```

The new comment does two things the old one did not: it names the sibling function it claims to mirror (so the claim is checkable by one grep), and it states the *consequence* of the list being narrower, so a future reader who wants to trim it has to argue against a stated risk rather than against a bare list.

PR #143 also pinned the role in tests. `app/api/admin/events/[id]/messages/send/route.test.ts:96-102`:

```ts
// A team_admin already sends member-wide broadcasts from the general Messages
// page (requireBroadcastAdmin); excluding them here only pushed a post-event
// thank-you into that wrong, unscoped tool. See lib/broadcast/event-auth.ts.
it("allows a team_admin to send", async () => {
  mockedCreateAdminClient.mockReturnValue(adminClient(teamAdmin, { id: "e1" }));
  expect((await post(validBody)).status).toBe(200);
});
```

with the mirror case at `app/api/admin/events/[id]/messages/preview/route.test.ts:70-76`. Full unit suite passed: 1338 tests across 94 files.

## Why This Works

**The comment was true when it was written. That is the whole point.** This was not a misreading — it is comment rot, and the timeline matters:

- **2026-05-21, PR #27.** Event messaging ships with `["events_admin", "super_admin"]` and the comment claiming it is "broader than member broadcasts (super_admin only)". At that moment `lib/broadcast/auth.ts` contained exactly one guard — `requireSuperAdmin`, with `if (!admin || admin.role !== "super_admin")` — documented as "used by every broadcast admin route (send, preview, drafts)". Member broadcasts really were `super_admin` only, and the event list really was broader. **The comment was accurate.**
- **2026-06-01, eleven days later, commit `bb843c6`** — *"feat(admin-messages): grant team admins access to member broadcasts"*. It splits out a shared `requireAdminRole` helper, adds `requireBroadcastAdmin(["super_admin", "team_admin"])`, and — per its own commit message — opens the feature "end-to-end: page guards, broadcast API routes, and nav". It does not touch `lib/broadcast/event-auth.ts`. The comment becomes false the moment that commit lands, and the event gate becomes the *narrower* one.
- **2026-08-20, PR #143.** Someone finally hits it.

Here is the current state the comment was describing, `lib/broadcast/auth.ts:48-49`:

```ts
export async function requireBroadcastAdmin(): Promise<RequireSuperAdminResult> {
  return requireAdminRole(["super_admin", "team_admin"]);
}
```

`requireSuperAdmin` (lines 40-42) survives as the `["super_admin"]`-only guard, now reserved for email settings and templates.

Two things made this durable. First, **nothing in the type system, the tests, or the linter has an opinion about a sentence in a comment** — so a statement that silently stopped being true stayed put through every subsequent refactor and review. Second, and more instructive: `bb843c6` was a *deliberate, careful widening*. Its author enumerated the surfaces to open — page guards, API routes, nav — and swept each one. What such a sweep cannot enumerate is a surface that never mentions the thing being widened. `event-auth.ts` does not import from `auth.ts`, does not reference `requireBroadcastAdmin`, and would not appear in any grep for the routes being changed. It only *described* them, in prose, from a distance. A hand-enumerated migration reliably reaches the code that calls the thing it is changing, and reliably misses the code that merely makes claims about it.

The narrowness was also anomalous within its own directory. Eleven other event admin routes carry the same four-role list:

```ts
["super_admin", "team_admin", "events_admin", "finance"]
```

Six of them, as a sample: `app/api/admin/events/[id]/tickets/[ticketId]/refund/route.ts:44`, `app/api/admin/events/[id]/resend-household/route.ts:12`, `app/api/admin/events/[id]/registrations/resend-bulk/route.ts:13`, `app/api/admin/events/[id]/ticket-types/route.ts:30`, `app/api/admin/events/update/route.ts:26`, `app/api/admin/events/create/route.ts:31`. Note the list is not uniformly expressed — the first three declare a named `const ALLOWED_ROLES`, the rest inline the array into an `.includes()` call, which is itself part of why the outlier was hard to see at a glance.

A `team_admin` could delete the event and refund its tickets, but not email its attendees. One `grep -rn '"team_admin"' app/api/admin/events/` would have exposed event messaging as the lone holdout at any point in those two and a half months.

**Why it presented as a dead UI rather than an error.** `EventMessaging.tsx` fetches the recipient count on mount, not on submit (`components/admin/EventMessaging.tsx:102-131`):

```ts
const fetchCount = useCallback(async () => {
  setFetchingCount(true);
  const res = await fetch(`/api/admin/events/${eventId}/messages/preview`, { method: "POST", ... });
  const data = await res.json();
  if (!res.ok) {
    setError(data.error || "Could not load recipient count.");
    setRecipientCount(null);        // ← stays null forever on a 403
  } else { ... }
}, [eventId, kind, includeNonConsented]);

useEffect(() => { fetchCount(); }, [fetchCount]);
```

The preview route returns `{ error: "Not authorized" }` at `app/api/admin/events/[id]/messages/preview/route.ts:17-20` before parsing anything, so `recipientCount` never leaves `null`. The send gate (`components/admin/event-messaging-state.ts:21-30`) requires it:

```ts
export function computeCanSend(i: SendGateInput): boolean {
  return (
    !i.subjectEmpty && !i.bodyEmpty && !i.fetchingCount && !i.sending &&
    i.recipientCount !== null && i.recipientCount > 0
  );
}
```

`canSend` is wired straight to `disabled={!canSend}` on the Send button (`EventMessaging.tsx:135, 275`). So the authorization failure arrives at page load, is rendered as a two-word string in a generic error slot (line 297), and permanently disables the only control that could have produced a richer error. This is the structural difference from a gate that rejects at submit: a submit-time 403 gives the user an action to describe ("I clicked Send and got X"); a mount-time 403 gives them a page that looks broken, and their only honest bug report is "it doesn't work."

**Why the near-miss belongs in the root cause, not in a user-error column.** The admin did not misuse the broadcast tool out of carelessness. The precise tool was closed to them and the imprecise one was open — the general Messages pages gate on `super_admin` or `team_admin` inline (`app/(admin)/admin/messages/page.tsx:39`), and the broadcast API routes behind them use `requireBroadcastAdmin`, which allowed them all along. The permission gap did not stop the message; it chose a worse delivery mechanism for it. An over-restrictive gate on a specific tool is not conservative when a broader tool remains reachable: it is an active push toward the blunter instrument.

## Prevention

**1. Every role in an allow-list gets a test case, in both directions.** The model already in this repo is `app/api/admin/events/[id]/tickets/[ticketId]/refund/route.test.ts` — the allow block at line 433, the forbid block at line 445:

```ts
// The route moves money with the same role list that previously only flipped a flag, so the
// allowlist is pinned in both directions.
it.each(["super_admin", "team_admin", "events_admin", "finance"])("allows %s", async (role) => {
  mockedAdmin.mockReturnValue(adminClient({ admins: [{ id: "a1", role }], ... }));
  expect((await post()).status).toBe(200);
});

it.each(["door_staff", "originator", "viewer"])("forbids %s", async (role) => {
  mockedAdmin.mockReturnValue(adminClient({ admins: [{ id: "a1", role }] }));
  expect((await post()).status).toBe(403);
});
```

Prefer this `it.each` shape over hand-written per-role cases. Hand-written cases drift: as of this writing, `app/api/admin/events/[id]/messages/preview/route.test.ts` covers `events_admin` (via the `beforeEach` default at line 50) and `team_admin` (line 73), but has **no `super_admin` case** — the send test has all three (`send/route.test.ts:85, 91, 99`), the preview test does not. An `it.each` over the allow-list makes that class of gap impossible, and the forbid-direction list catches the opposite mistake — a role silently widened in.

**2. Treat a comment that asserts what another module does as an untested claim with an expiry date you cannot see.** The smell is specific and greppable: a comment naming a different function, module, or table and stating its behaviour. Being *correct when written* is no defence — that is the normal case, and it is precisely why these rot undetected. The referenced code moves independently; nothing links the two. At review time, either verify it against the cited source, or make the claim executable.

**2b. When you widen a permission, grep for prose about it, not just callers of it.** `bb843c6` opened member broadcasts to `team_admin` "end-to-end" and correctly swept every *caller*: page guards, API routes, nav. It still missed `event-auth.ts`, because that file does not call the widened code — it only describes it. A migration checklist built from references, imports, or type errors is structurally blind to the files that make claims in comments. After a deliberate widening, run one text search for the old rule (here, `grep -rn 'super_admin only'`) and read what comes back. Two and a half months of this bug fit in that one grep.

Note that this same class of residue still exists in the current tree, in three places that were not updated by PR #143:

- `lib/broadcast/event-auth.ts:17-18` — the `requireEventsAdmin` doc block still says "confirm the caller is an `events_admin` or `super_admin`".
- `app/api/admin/events/[id]/messages/preview/route.ts:9` — "Gated to events_admin / super_admin".
- `app/api/admin/events/[id]/messages/send/route.ts:8` — "Gated to events_admin / super_admin".

None of these gates behave that way any more; `ALLOWED_ROLES` at line 10 is the only thing that decides. They are currently harmless prose, but they are exactly the raw material the original bug was made from — the next person who "aligns the code with the docs" reintroduces it.

**3. On making the relationship executable — and its real cost.** A test file for `event-auth` does not exist today (the module is unit-tested only indirectly, through its two route tests). A dedicated one *could* assert the invariant directly:

```ts
// event messaging must never be narrower than member-wide broadcasts
it("allows every role requireBroadcastAdmin allows", () => { ... });
```

The honest problem is that `requireBroadcastAdmin` does not export its list — it passes `["super_admin", "team_admin"]` inline to `requireAdminRole` (`lib/broadcast/auth.ts:49`), and `ALLOWED_ROLES` in `event-auth.ts:10` is module-private. Asserting the relationship requires exporting both constants, which is a small widening of two modules' public surface purely for a test. Deriving one list from the other (`[...BROADCAST_ROLES, "events_admin"]`) is tighter still, but couples an event-scoped gate to a member-scoped one, so any future widening of member broadcasts silently widens event messaging too — a coupling that is right today only because the event tool is the *narrower-blast-radius* one. Given a repo with 20+ hand-maintained role lists, the higher-yield guardrail is #1 (per-route `it.each` coverage) plus #2 (kill comments that claim things about other modules); reserve the exported-constant assertion for pairs where one gate genuinely must dominate the other and the direction is stated.

**4. When scoping an admin permission, ask what the person will do instead.** "Deny by default" is only safe when denial is terminal. If a broader, blunter tool stays reachable, restricting the precise one moves the work rather than stopping it. Before excluding a role from a scoped surface, check what that same role can already reach: if they can broadcast to the whole membership, denying them a single event's attendee list makes the outcome *less* targeted, not safer.

**5. Prefer authorization failures that surface at the point of action.** A gate evaluated inside a mount-time data fetch converts a 403 into an inert page. If a surface must fetch on mount (as `EventMessaging` does — the recipient count is genuinely needed before Send is meaningful), then the 403 branch deserves a message that names the cause and the remedy ("Your role cannot send event messages — ask a super_admin"), not the route's generic `"Not authorized"` string echoed into a red paragraph. The current UI at `EventMessaging.tsx:112-114, 297` passes the server string straight through, which is the least diagnostic option available.

## Related Issues

- **PR #143** — `fix(events): let team_admin send event-scoped messages`, merged 2026-08-20. The gate was written by PR #27 (`feat(events): event messaging on Manage Event (pre-event + post-event)`, 2026-05-21), where it was correct; it was falsified by commit `bb843c6` (`feat(admin-messages): grant team admins access to member broadcasts`, 2026-06-01), which widened member broadcasts without revisiting the event gate that described them.
- [`../best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md`](../best-practices/a-comment-that-justifies-an-omission-is-load-bearing.md) — closest sibling, same root cause in the opposite direction. There, a comment asserting another subsystem's behaviour rotted and kept a wrong *omission* alive; here it kept a wrong *access decision* alive. Its ordered remedy (encode in the type > write a failing test > only then a comment) is exactly what was missing: PR #143 supplied the middle rung.
- [`../design-patterns/guard-shared-content-as-entity-specific-2026-05-21.md`](../design-patterns/guard-shared-content-as-entity-specific-2026-05-21.md) — the named parent rule, "a stale in-code comment is an assumption, not a spec", plus "a guard that converts wrong content into no access trades one failure for another". That doc stops at the blocked workflow; this one follows the user to what they did instead.
- [`nullish-default-turns-a-missing-record-into-a-confident-false-claim.md`](nullish-default-turns-a-missing-record-into-a-confident-false-claim.md) — sibling silent-UI failure: no error, no log line, no failing test, because the wrong state was the reassuring one.
- [`../conventions/jsonb-filter-singular-to-plural-evolution.md`](../conventions/jsonb-filter-singular-to-plural-evolution.md) — documents `audience_filter`, the `{status, tier_ids}` JSONB with no event concept that made the workaround draft membership-wide by construction.
- [`../architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md`](../architecture-patterns/channel-agnostic-broadcast-adapter-2026-04-29.md) — the adapter unified audience *resolution* across `lib/broadcast`, but nothing unified the two role allow-lists in front of it, which is how they drifted apart.
- [`../security/supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md`](../security/supabase-anon-exposure-rls-off-and-anon-executable-rpcs.md) — the mirror image at the DB layer: broadcast access control that was too *open*. Read together, the two show both failure directions on the same feature.
- **Issue #12** (open since 2026-05-05) — asked for an auth matrix over the *agent API* surface, and explicitly scoped **out** "backfilling tests for the existing `lib/broadcast/*` helpers (also untested today)". The hole this bug lived in was named in that issue and deliberately left open for three months. The useful follow-up is not to close #12 but to widen it: a role × route matrix spanning *both* broadcast auth gates, so the two allow-lists cannot drift silently again.
- **Open, not fixed by #143:** the event Messages tab has no draft-save. `EventMessaging.tsx` offers only Preview (implicit, via the on-mount count) and Send — compare `BroadcastComposer.tsx:67, 98, 346`, which has `canSaveDraft`, `handleSaveDraft`, and a Save draft button backed by `/api/admin/broadcasts/drafts`. This is a contributing cause of the near-miss, not an incidental one: an admin who wants to draft an event message, sit on it, and send later still has to compose it on the member-wide page. Fixing the permission removed the hard block; it did not remove the pull toward the wrong tool for anyone who wants to save work in progress.
- **Open, not fixed by #143:** the three stale role-list comments listed under Prevention #2.
- **Unexecuted plan carrying the same false premise:** `docs/plans/2026-04-29-002-feat-broadcast-image-upload-plan.md` states "Who has upload rights in v1? super_admin only. Same role gate as broadcast send." Broadcast send is not `super_admin` only and never was. Executing that plan as written would ship a fresh over-restrictive allow-list built on the premise PR #143 just retired.
