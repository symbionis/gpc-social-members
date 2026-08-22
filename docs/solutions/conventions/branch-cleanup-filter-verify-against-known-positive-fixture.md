---
title: "A branch-cleanup filter that matches nothing looks exactly like a clean repo"
date: 2026-08-22
category: conventions
module: development_workflow
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - "A pipeline greps a command's human-readable output and a zero-match result means \"nothing to do\""
  - "You change a verbosity or format flag on a command whose output feeds a filter"
  - "You are deleting a local branch in this squash-merge repo"
  - "You inherited a diagnosis about tool behavior that you have not reproduced yourself"
tags:
  - git-workflow
  - branch-cleanup
  - squash-merge
  - silent-failure
  - grep-pipeline
  - slash-command
related_components:
  - development_workflow
  - tooling
---

# A branch-cleanup filter that matches nothing looks exactly like a clean repo

## Context

`commit-commands:clean_gone` is an installed plugin slash-command that deletes local branches whose
upstream was deleted on the remote, removing any attached worktree first. It is **not code in this
repository** — it lives in the plugin cache, so it is invisible to a repo-wide grep and cannot be
fixed by a PR here. Its core pipeline greps git's human-readable branch listing:

```bash
git branch -v | grep '\[gone\]' | sed 's/^[+* ]//' | awk '{print $1}' | while read branch; do
  # remove worktree if any, then git branch -D "$branch"
done
```

and it closes with: *"If no branches are marked as [gone], report that no cleanup was needed."*

An earlier session ran it when three local branches genuinely had deleted upstreams
(`symbionis/add-claude-md`, `symbionis/compound-replay-guard-key`,
`symbionis/investigate-enlighten-event-name`), reported that the skill's own pattern matched nothing
while `git branch -vv | grep ': gone\]'` listed all three, and handed forward a diagnosis:
*`git branch -v` prints no tracking information, so `\[gone\]` can never match.*

We rebuilt the scenario from scratch — a bare remote, a pushed branch, deleted on the remote,
`fetch --prune` — and reproduced it directly on git 2.50.1 (Apple Git-155). **Both halves of that
diagnosis are false.** `git branch -v` does print `[gone]`, and the shipped pattern does match:

```
$ git branch -v
  feature/x <sha> [gone] work
* main      <sha> init

$ git branch -v | grep -c '\[gone\]'
1
```

The earlier zero-match is a reported observation whose mechanism we could not reproduce and cannot
explain. Treat it as unconfirmed — do not repeat "the skill is broken as shipped." What the
reproduction *did* surface is a real trap that is easy to walk into deliberately.

## Guidance

**Match the grep pattern to the verbosity flag.** `git branch -v` prints only the *track state*
inside the brackets. `git branch -vv` prints `[<upstream>: <state>]` — the upstream name and a `: `
separator sit between the opening bracket and the state word. The two are mutually incompatible:

```bash
# -v  → brackets contain the state alone
git branch -v  | grep '\[gone\]'

# -vv → brackets contain "<upstream>: <state>"
git branch -vv | grep ': gone\]'

# flag-agnostic: match the word, not the bracketing
git branch -vv | grep 'gone\]'
```

Swapping `-v` for `-vv` is the natural instinct, because `-vv` is the documented way to see upstream
names — and it is exactly the swap that turns `grep '\[gone\]'` into a no-op that still exits
cleanly. Verified counts on one fixture:

```
git branch -v  | grep -c '\[gone\]'   ->  1   (matches)
git branch -vv | grep -c '\[gone\]'   ->  0   (silently finds nothing)
git branch -vv | grep -c ': gone\]'   ->  1   (matches)
```

Better still, skip the rendered line entirely. `git for-each-ref` exposes the same fact as a stable
field instead of display formatting:

```bash
git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads
```

**Never trust a zero-match from a filter you have not watched match.** Build a known-positive
fixture — it takes about thirty seconds:

```bash
cd "$(mktemp -d)"
git init -q --bare remote.git
git init -q work && cd work
git commit -q --allow-empty -m init
git remote add origin ../remote.git
git push -q -u origin main

git checkout -q -b feature/x
git commit -q --allow-empty -m work
git push -q -u origin feature/x

git push -q origin --delete feature/x   # simulate GitHub delete-on-merge
git fetch -q --prune

git branch -v      # expect: feature/x <sha> [gone] work
git branch -vv     # expect: feature/x <sha> [origin/feature/x: gone] work
```

Run the candidate pipeline against this repo. If it prints nothing *here*, it will print nothing in
the real repo too — and there it will look like success.

**Squash merges defeat git's delete safety check.** This repo squash-merges, so a merged branch's
commits never become ancestors of `main` (the mechanic is already documented in
[merging a stacked PR into a squash-merge repo](merging-a-stacked-pr-into-a-squash-merge-repo.md) —
that doc covers the merge-time consequence; this is the cleanup-time one). Both guardrails
false-alarm on every landed branch:

```
$ git branch -d feature/x
error: the branch 'feature/x' is not fully merged
hint: If you are sure you want to delete it, run 'git branch -D feature/x'

$ git branch --merged main
* main
```

Because `-d` cries wolf every time, `-D` becomes reflexive, and git's only guardrail stops meaning
anything. Move the safety check off git and onto the content. Before forcing a delete, confirm both:

1. Every file the branch touched exists in `main` with the expected content
   (`git diff --stat main...<branch>`, then check those paths on `main`).
2. The upstream is `gone` — deleted by GitHub's delete-on-merge — not merely unpushed.

Those two together are what cleared the three branches above. A branch that is `gone` but whose
changes are *not* in `main` is a red flag, not a cleanup candidate.

**No fix was made to the plugin skill.** It is installed tooling outside this repository, and the
reproduction did not establish that it is broken as shipped. The remedy is knowing the correct
invocation and verifying against a fixture before believing a clean result.

## Why This Matters

**A cleanup filter that fails closed is invisible.** When the grep matches nothing, the pipeline
reports "no cleanup was needed", exits 0, and that output is byte-for-byte identical to a genuinely
tidy repo. No error, no stderr, no non-zero status, nothing to alert on. You accumulate stale
branches and orphaned worktrees while being told you are clean. This is the same failure family as
[the PostHog sourcemap upload that was silently inert](../integration-issues/posthog-sourcemap-upload-silently-inert.md),
whose Prevention section already states the general rules — *verify at the destination, not the
source*, and *when a gate exists so absence is tolerated, absence stops being observable*. The
grep-fixture rule above is those rules applied to a text filter: the fixture **is** the destination
check.

**Matching human-readable output is brittle by construction.** The `-v`/`-vv` bracket contents are
display formatting, not an interface contract. One extra `v` changes the string shape and breaks the
pattern with no signal. Where porcelain exists, prefer it.

**Inherited diagnoses are worth the minutes to reproduce.** The handed-down explanation here was
confident, plausible, mechanically specific — and wrong in both of its two claims. Reproducing it
cost a throwaway repo and a few commands, and the reproduction is what turned up the real trap.

## When to Apply

- Any time a pipeline greps a command's human-readable output — git, docker, kubectl, npm — and a
  zero-match would be read as "nothing to do."
- Before trusting a cleanup, prune, or reconciliation tool that reports "nothing found," especially
  on its first run or after any flag change.
- When changing a verbosity, format, or `--porcelain` flag on a command whose output feeds a filter.
  Do not assume more output is a superset of less.
- Before `git branch -D` anywhere in this repo.

## Examples

**Before — trusting the zero-match.** Change `-v` to `-vv` to see upstream names, keep the pattern,
and get a clean bill of health on a repo that has a gone branch sitting in it:

```bash
$ git branch -vv | grep '\[gone\]' | awk '{print $1}'
$ echo $?
0        # awk ends the pipeline, so grep's no-match status is swallowed
# "No branches are marked as [gone]. No cleanup was needed."
```

Note the exit status. `$?` reports the *last* command in the pipeline — `awk`, which succeeds on
empty input — so grep's no-match `1` is discarded before anyone could branch on it. Recovering it
takes `set -o pipefail` or `${PIPESTATUS[1]}`. A swallowed non-zero status inside a pipeline is the
same silent-failure shape as the pattern that did not match: the signal exists for an instant and
nothing is listening.

**After — pattern matched to the flag, verified against a known-positive fixture:**

```bash
$ git branch -vv
  feature/x <sha> [origin/feature/x: gone] work
* main      <sha> [origin/main] init

$ git branch -vv | grep ': gone\]' | sed 's/^[+* ]//' | awk '{print $1}'
feature/x
```

**The same bracket asymmetry on a live branch in this repo** (no gone branches at present, but the
shape is identical):

```
$ git branch -v
  symbionis/feat-attendee-price-pills  9721100 [behind 18] feat(events): ...

$ git branch -vv
  symbionis/feat-attendee-price-pills  9721100 [origin/main: behind 18] feat(events): ...
```

`-v` gives `[behind 18]`; `-vv` gives `[origin/main: behind 18]`. Anchoring a pattern to `\[` binds
it to one verbosity level.

**Squash-merge guardrail, before and after:**

```bash
# Before: believe git
$ git branch -d feature/x
error: the branch 'feature/x' is not fully merged     # false alarm after a squash merge
$ git branch --merged main
* main                                                # feature/x absent, though it landed

# After: verify the content, then force
$ git diff --stat main...feature/x                    # list the touched paths
$ git show main:path/to/touched-file >/dev/null       # confirm each landed on main
$ git branch -vv | grep 'feature/x'                   # confirm upstream is gone
  feature/x <sha> [origin/feature/x: gone] work
$ git branch -D feature/x
```

## Related

- [Merging a stacked PR into a squash-merge repo](merging-a-stacked-pr-into-a-squash-merge-repo.md) —
  the merge-time consequence of the same squash-merge non-ancestry mechanic.
- [PostHog sourcemap upload silently inert](../integration-issues/posthog-sourcemap-upload-silently-inert.md) —
  the repo's general statement on fail-closed tooling and verifying at the destination.
- `CLAUDE.md` > Working practice — the worktree and `git add -A` rules that govern the cleanup this
  tooling performs.
