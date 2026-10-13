---
description: "Render the worktree management section on the worktree-console bundle's page, and the worktree checkbox in the composer tool row. Contributes no model context of its own."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-console

English | [中文](README.zh.md)

## Summary

Render the worktree management section on the worktree-console bundle's page, and the worktree checkbox in the composer tool row. Contributes no model context of its own.

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
| `plugins.detail.section`, id `worktree-console` | The master-detail section, on the bundle's own detail page and nowhere else. |
| `conversation.input.left`, id `worktree` | The composer checkbox — a box to tick for an empty Session, a read-only badge for a Session already in a worktree. |

Both read the `worktrees` Remote; neither owns state the Host does not.

<a id="understand-the-implementation"></a>
## Understand the implementation

The section decides from the page subject whether it belongs where it was rendered, returning nothing for every subject it does not own, so it never competes with a plugin's own configuration.

The Remote-facing functions live in their own module rather than inside the components. That keeps a browser spec able to run against a literal face instead of the generated Remote artifact, which only exists after a build.

Neither component decides what the Host already decided. The section renders the arm flag and the entered checkout exactly as `state` reports them, and the checkbox renders nothing until the Host has answered — so a mount cannot flicker between armed and not, and a badge cannot report a checkout the Host never made.

<a id="model-experience"></a>
## Model Experience

### Composer worktree checkbox

#### What the model sees

Nothing from this package. It renders controls in the browser; the model-visible change is the working-directory switch the Host makes when the armed step runs, which the model then sees as `Current working directory`.

#### Token effect

None. The toggle, the badge and the management table never enter a model request.

#### KV Cache effect

None. No model context is produced, so no cached prefix changes because of this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The checkbox reaches only empty Sessions** — the rule is enforced by the client not rendering the control, and the Host does not re-check it.
- **The badge does not refresh within a Session** — the Host's state is read when the checkbox mounts, so a worktree entered later in the same Session appears only after a remount.
- **The change check cannot see ignored files** — the section reports tracked and untracked changes, so a checkout whose only content is ignored reads as clean.
