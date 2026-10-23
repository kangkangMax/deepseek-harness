---
description: "List, prune, and remove the Git worktrees of registered workspaces from Settings, and arm an empty Session to enter one on its next step."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-console

English | [中文](README.zh.md)

## Summary

List, prune, and remove the Git worktrees of registered workspaces from Settings, and arm an empty Session to enter one on its next step. Reads Git's own registrations, so a checkout any tool created stays visible.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount alongside `subprocess`, `sandbox`, `fs`, and `workspaceRegistry`. Every method is a Remote under the `worktrees` namespace.

| Method | Purpose |
| --- | --- |
| `list()` | Every registered repository that is a Git repository root, with every worktree Git has on record for it — including the repository's own checkout, which reports `primary`. |
| `prune(repositoryId)` | Clear registrations whose checkout directory is gone. Idempotent; reports only what Git actually cleared. |
| `removeWorktree(repositoryId, path, force, confirmedSessionIds)` | Archive the confirmed associated Sessions, then remove the worktree and its registration. Refuses unconfirmed Sessions, active Sessions, and dirty files without `force`. The primary checkout is protected. |
| `arm(sessionId, request)` / `disarm(sessionId)` | Set or drop an intent so the Session's next step materializes a worktree first. |
| `state(sessionId)` | The arm flag, accepted `request` while armed, the checkout once one exists, and the last failure. |
| `branches(sessionId)` | The Session directory's repository and its local branches, for the composer's base picker. A null repository means that directory is outside every repository. |

`arm` requires the official worktree runtime, a live Session, and its `sessionProjections` turn state. Missing providers or turn state fail with `worktree/unavailable`; a Session with a started turn fails with `worktree/session-started`. The remaining management methods stay available.

`branches` reports the repository of the Session's current directory for both the header branch control and the composer's base picker. When `sessionQuery` is available, a disposable observation supplies the persisted working-directory projection without starting an Agent. Without it, the method reads the attached Session through `sessions`. A composition without `workingDirectory` reports no repository instead of failing to activate; an unavailable or unreadable Session is reported as an error.

`list` and `removeWorktree` require `sessionQuery` and working-directory projections. Each row's `sessionIds` identifies accessible, unarchived Sessions whose current directory is the checkout or a subdirectory, including persisted Sessions after a Host restart. Removal rechecks those associations and requires access to every associated Session and explicit confirmation of its id. New associations return `worktree/sessions-unconfirmed` before any archive or deletion. File-loss confirmation remains separate.

Archiving retains chat history and uses the Workspace registry's durable archive and activity checks. A failed archive prevents checkout removal. If a later archive or Git operation fails, `worktree/removal-incomplete` reports the archived ids; those archives remain, and the caller must refresh before retrying. A stale row follows the same confirmation and archival rules. `prune` only clears Git registrations and does not archive Sessions.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service owns no registry. The truth is `git worktree list` per repository, read on demand, so a checkout created by any plugin or by hand stays visible without that plugin cooperating.

Source is inferred from a path table rather than recorded: the official plugin's pool is `<repository>/.agents/worktrees`, and a checkout under a `worktree-space` container is attributed to `dsh-worktree-space`. A checkout no rule claims reports as `manual` - a visible unknown rather than a confident wrong answer. Nothing that deletes consults the label.

Git commands run without a shell or sandbox confinement, with lazy fetching, hooks, and filesystem monitoring disabled. Worktree inventory uses NUL-delimited paths. Git's first registration identifies the main checkout even when the registered workspace is a linked checkout. A status-read failure rejects the inventory instead of reporting an unreadable checkout as clean.

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
- **Ignored files are separate from changes** — inventory includes ignored paths, and unconfirmed removal refuses to discard them.
- **Session state is process-local** — the armed intent and the entered checkout live in memory and do not survive a Host restart.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

`npx vitest run packages/experimental/worktree-console` exercises this package against real Git repositories in temporary directories; no API key is needed.

</details>
