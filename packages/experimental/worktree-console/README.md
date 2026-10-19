---
description: "List, prune, and remove the Git worktrees of the registered workspaces from the Plugins page, and arm an empty Session to enter one on its next step. Reads Git's own registrations, so a checkout any tool created stays visible."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-console

English | [中文](README.zh.md)

## Summary

List, prune, and remove the Git worktrees of the registered workspaces from the Plugins page, and arm an empty Session to enter one on its next step. Reads Git's own registrations, so a checkout any tool created stays visible.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount alongside `subprocess`, `sandbox`, `fs`, and `workspaceRegistry`. Every method is a Remote under the `worktrees` namespace.

| Method | Purpose |
| --- | --- |
| `list()` | Every registered repository that is a Git repository root, with the worktrees Git has on record for it. |
| `prune(repositoryId)` | Clear registrations whose checkout directory is gone. Idempotent; reports only what Git actually cleared. |
| `removeWorktree(repositoryId, path, force)` | Remove one worktree and its registration. Refuses a dirty checkout unless `force` is set. |
| `arm(sessionId, request)` / `disarm(sessionId)` | Set or drop an intent so the Session's next step materializes a worktree first. |
| `state(sessionId)` | The arm flag, the checkout once one exists, and the last failure. |
| `branches(sessionId)` | The Session directory's repository and its local branches, for the composer's base picker. A null repository means that directory is outside every repository. |

`arm` needs the official worktree runtime to be loaded; without it, `arm` fails with `worktree/unavailable` and the rest of the page keeps working.

`branches` reports the repository of the Session's *current* directory, because that is where the armed step creates the checkout. It reads `sessions` and `workingDirectory` rather than injecting them, so a composition without either reports no repository instead of failing to activate.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no registry. The truth is `git worktree list` per repository, read on demand, so a checkout created by any plugin or by hand stays visible without that plugin cooperating.

Source is inferred from a path table rather than recorded: the official plugin's pool is `<repository>/.agents/worktrees`, and a checkout under a `worktree-space` container is attributed to `dsh-worktree-space`. A checkout no rule claims reports as `manual` - a visible unknown rather than a confident wrong answer. Nothing that deletes consults the label.

Every git command runs unconfined by a shell, with lazily-fetched objects, repository hooks, the filesystem monitor, and path quoting all disabled. The sandbox fence root is the repository being operated on, which covers both the shared `.git` and the official pool inside it.

Entering a worktree is one delegation to the official runtime, which publishes the new working directory itself as the last step of a successful creation.

<a id="model-experience"></a>
## Model Experience

### Session worktree entry

#### What the model sees

Entering a worktree is a working-directory change: the Session's current-directory context becomes the new checkout, and the model's file tools resolve against it. The management methods (`list`, `prune`, `removeWorktree`) contribute nothing to model context.

#### Token effect

One directory context entry per entry, the same as any other working-directory change. Listing and repairing add no tokens.

#### KV Cache effect

The directory change appends context after retained history rather than replacing the stable system-prompt prefix, so the cached prefix survives the transition.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Source is inferred, not recorded** — a plugin that changes its default landing spot makes its checkouts report as `manual`. The page shows a visible unknown rather than misattributing them, and no repair depends on the label.
- **The page's own git commands are unconfined** — they are actions a person asked for, with arguments built in this package and paths read back from `git worktree list`, so the sandbox seam is never consulted; what an *agent* may do to a worktree is a separate path with its own policy.
- **Ignored files are not part of the change check** — `git status --porcelain` reports tracked and untracked changes only, so a checkout whose only content is ignored reads as clean.
- **Session state is process-local** — the armed intent and the entered checkout live in memory and do not survive a Host restart.
