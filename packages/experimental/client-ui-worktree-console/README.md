---
description: "Provide the worktree management page in the Settings panel, and the worktree checkbox and branch line in the composer. Contributes no model context of its own."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-console

English | [中文](README.zh.md)

## Summary

Provide the worktree management page in the Settings panel, and the worktree checkbox and branch line in the composer. Contributes no model context of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mounted by `@deepseek-ai/dsh-experimental-worktree-console-bundle`; not mounted on its own. It registers three contributions.

| Seat | Behaviour |
| --- | --- |
| `settings.section`, id `worktree-console` | The management page, behind its own `Worktrees` row in the Settings navigation. |
| `conversation.input.left`, id `worktree` | The composer checkbox — a box to tick for an empty Session, then a base picker beside it. After a run the Host refused, the row reports the reason instead: the arm is spent, so a toggle would arm nothing. A Session already in a worktree has nothing left to decide here, so the row renders nothing. |
| `conversation.composer.dock`, id `worktree-context` | The line under the input naming the branch the Session will run in, with the checkout directory on its hover. |

All three read the `worktrees` Remote; none owns state the Host does not.

The base picker arrives with the tick, not before it. An unchecked box has nothing to qualify yet, and a base waiting beside it would read as a setting to get right before the checkbox means anything. It also keeps the branch list unread for every conversation that never arms one, which is most of them.

<a id="understand-the-implementation"></a>
## Understand the implementation

The page owns one Settings navigation row, so it never competes with a plugin’s own configuration for space in a detail page.

The table ranks its columns by what identifies a row. The branch name takes every pixel left over — the only column that tells two rows apart gets the space — while the commit and the absolute directory live in the branch cell’s hover card, beside `Copy path` and, where the Host has a desktop, `Reveal`. Source is a narrow fixed column and is dropped first when the pane narrows.

The composer line prints one value. The branch is the shortest answer to “where am I about to work?” and the only one that changes between Sessions on the same repository; the checkout directory is long enough to push the rest of the dock off. So the line prints the branch and its hover names the directory — which names the repository too, as that path’s last segment.

The Remote-facing functions live in their own module rather than inside the components. That keeps a browser spec able to run against a literal face instead of the generated Remote artifact, which only exists after a build.

No component decides what the Host already decided. The page renders the arm flag and the entered checkout exactly as `state` reports them, and the checkbox and the branch line render nothing until the Host has answered — so a mount cannot flicker between armed and not, and none of them can report a checkout the Host never made.

Both composer readings also re-read when a run ends. A refused arming ends the turn before the model is called, so its reason exists in exactly one place — the Host’s reading — and that run is the only thing that says to look again. Without the re-read a refusal is a turn that completes with nothing in it, and a materialized worktree leaves the line naming the repository’s own checkout for the rest of the Session.

<a id="model-experience"></a>
## Model Experience

### Composer worktree checkbox

#### What the model sees

Nothing from this package. It renders controls in the browser; the model-visible change is the working-directory change the Host makes when the armed step runs, which the model then sees as `Current working directory`.

#### Token effect

None. The checkbox, the badge and the management table never enter a model request.

#### KV Cache effect

None. No model context is produced, so no cached prefix changes because of this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The checkbox reaches only empty Sessions** — the rule is enforced by the client not rendering the control, and the Host does not re-check it.
- **Composer readings refresh between runs, not during one** — the branch, directory and arming state are re-read once when a run ends, so a checkout that moves mid-run keeps the previous name until it finishes.
- **The change check cannot see ignored files** — the page reports tracked and untracked changes, so a checkout whose only content is ignored reads as clean.

### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

`npx vitest run packages/experimental/client-ui-worktree-console` renders the components in jsdom against a literal face, so no Host or build artifact is needed.

</details>
