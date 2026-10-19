---
description: "Provide the worktree management page in the Settings panel, and the worktree checkbox in the composer tool row. Contributes no model context of its own."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-console

English | [中文](README.zh.md)

## Summary

Provide the worktree management page in the Settings panel, and the worktree checkbox in the composer tool row. Contributes no model context of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mounted by `@deepseek-ai/dsh-experimental-worktree-console-bundle`; not mounted on its own. It registers two contributions.

| Seat | Behaviour |
| --- | --- |
| `settings.section`, id `worktree-console` | The management page, behind its own `Worktrees` row in the Settings navigation. |
| `conversation.input.left`, id `worktree` | The composer checkbox — a box to tick for an empty Session, then a base picker beside it, and a read-only badge for a Session already in a worktree. |

Both read the `worktrees` Remote; neither owns state the Host does not.

The base picker arrives with the tick, not before it. An unchecked box has nothing to qualify yet, and a base waiting beside it would read as a setting to get right before the checkbox means anything. It also keeps the branch list unread for every conversation that never arms one, which is most of them.

<a id="understand-the-implementation"></a>
## Understand the implementation

The page owns one Settings navigation row, so it never competes with a plugin’s own configuration for space in a detail page.

The Remote-facing functions live in their own module rather than inside the components. That keeps a browser spec able to run against a literal face instead of the generated Remote artifact, which only exists after a build.

Neither component decides what the Host already decided. The page renders the arm flag and the entered checkout exactly as `state` reports them, and the checkbox renders nothing until the Host has answered — so a mount cannot flicker between armed and not, and a badge cannot report a checkout the Host never made.

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
- **The badge does not refresh within a Session** — the Host's state is read when the checkbox mounts, so a worktree entered later in the same Session appears only after a remount.
- **The change check cannot see ignored files** — the page reports tracked and untracked changes, so a checkout whose only content is ignored reads as clean.
