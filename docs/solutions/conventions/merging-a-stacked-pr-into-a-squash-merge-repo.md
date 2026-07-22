---
title: "Merging a stacked PR into a squash-merge repo: rebase --onto to drop the duplicated base commit"
date: 2026-07-22
category: conventions
module: development_workflow
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - "PR B is stacked on PR B's parent PR A (B branched off A's branch)"
  - "The repository squash-merges PRs, so A lands on main as one new commit"
  - "You are merging the stack in order"
tags:
  - stacked-prs
  - squash-merge
  - rebase-onto
  - git-workflow
  - force-with-lease
related_components:
  - development_workflow
---

# Merging a stacked PR into a squash-merge repo: rebase --onto to drop the duplicated base commit

## Context

This repo squash-merges PRs. During the U15/U14/R28 work, PR #91 (U14) was **stacked** on PR #90 (U15) — its branch was `<U15-commit> + <U14-commit>`, and its PR base was the U15 branch. When #90 squash-merged, `main` gained a *new* commit containing U15's tree, but that squash commit is **not an ancestor** of #91's branch. A naive "merge #91 next" then shows U15's changes again (or conflicts), because git's merge base is still the pre-U15 commit.

## Guidance

Merge the stack in order, and after the parent squash-merges, re-base the child onto the new `main` so its diff is child-only:

1. **Merge the parent** (`gh pr merge <A> --squash`). Note the parent branch's tip SHA *before* it's deleted — you need it for step 2.
2. **Rebase the child onto the new main, dropping the parent commit:**

   ```bash
   git fetch origin main
   # replay only the commits AFTER the parent tip onto the squashed main
   git rebase --onto origin/main <A-branch-tip-sha> <child-branch>
   ```

   `--onto` replays only the child's own commits. Because the squashed `main` already contains the parent's tree, and the child's commit is a diff on top of that same tree, it applies cleanly — the duplicated parent commit is dropped.
3. **Retarget the child's PR base to `main`.** GitHub does *not* auto-retarget if you kept the parent branch (auto-retarget only fires when the base branch is deleted). `gh pr edit <B> --base main`.
4. **Verify locally, then force-push with lease:** `rm -rf .next` if routes moved, re-run tsc + the affected tests, then `git push --force-with-lease`. Never force-push an unverified tree onto a PR branch.
5. **Merge the child.** A transient `UNSTABLE` mergeable state right after the force-push is usually CI re-running — check `gh pr checks` rather than assuming a conflict.

For a **sibling** PR that merely branched off the old `main` (not stacked, but overlapping files), a plain `git rebase origin/main` is enough — disjoint hunks in a shared file (e.g. `types/database.ts`) auto-merge; verify the merged result (`grep`-confirm both sides landed) before force-pushing.

## Why This Matters

Squash-merge and stacked PRs interact badly by default: the squash commit hides the parent's individual commit, so the child still "carries" it and git can't tell the changes already landed. Left alone, the child PR shows a doubled diff or spurious conflicts, and reviewers can't see what's actually new. `rebase --onto` is the one operation that says "keep my commits, forget my old base" — it's what makes the child PR review cleanly as child-only. Skipping the base retarget (step 3) is the common miss when the parent branch is kept around.

## When to Apply

- Any time you stack PRs (B depends on A's unmerged code) in a squash-merge repo and merge them in sequence.
- Not needed when each PR is independent and branches off `main`.

## Examples

- **The sequence**: #90 (U15) merged first. #91 (U14) was `git rebase --onto origin/main <U15-tip> feat/…-u14` → a single U14 commit on main, base retargeted to `main`, re-verified (tsc + tests), force-pushed-with-lease, then merged. #92 (R28), a sibling off the old main, was plain-rebased onto the new main; `types/database.ts` auto-merged (U14's added columns and R28's removed column were disjoint regions), verified with a grep for both sides before force-pushing.
- **Result**: `main` history reads as three clean squash commits in order, no doubled diffs.

## Related

- Isolate each unit in its own worktree branched off fresh `origin/main` before this ever comes up.
