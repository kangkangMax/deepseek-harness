---
description: "Manage worktrees in Settings, prepare isolated Sessions from the composer, and inspect the current branch and directory in the Session header."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-console

English | [中文](README.zh.md)

## Summary

Manage worktrees in collapsible repository groups in Settings. Prepare an isolated Session from the composer, and inspect its current branch beside the Session mode. Directory details provide copy and optional desktop-open actions. This package contributes no model context.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mounted by `@deepseek-ai/dsh-experimental-worktree-console-bundle`; not mounted on its own. It registers four contributions.

| Seat | Behaviour |
| --- | --- |
| `settings.section`, id `worktree-console` | The management page, behind its own `Worktrees` row in the Settings navigation. |
| `conversation.input.left`, id `worktree` | The composer checkbox — a box to tick for an empty Session, then a base picker beside it. After a run the Host refused, the row reports the reason instead: the arm is spent, so a toggle would arm nothing. A Session already in a worktree has nothing left to decide here, so the row renders nothing. |
| `conversation.session.header.actions`, id `worktree-context` | The current branch after the Session mode. Hover for its full name, checkout directory, and directory actions. |
| `shell.overlay`, id `worktree-console.notice` | Operation results that remain visible after Settings closes. |

The page and composer read the `worktrees` Remote. The base picker restores the accepted intent from `state.request` and changes its displayed base only after the Host accepts a selection. Local and remote branches use fully qualified refs, so identically named branches remain distinct.

Remove always opens a confirmation dialog. When the worktree has associated Sessions, the dialog states their count and requires a separate acknowledgement to archive them while retaining chat history. Discarding file changes requires its own acknowledgement. Cancelling resets both acknowledgements. The Host rejects a removal if another Session becomes associated after the displayed inventory was read.

The base picker arrives with the tick, not before it. An unchecked box has nothing to qualify yet, and a base waiting beside it would read as a setting to get right before the checkbox means anything. It also keeps the branch list unread for every conversation that never arms one, which is most of them.

The card is searchable once the repository has more than six branches. Below that a flat list is scanned faster than it is searched, and a field over three rows is a field that never earns its space; above it, twenty branches cannot be scanned at all. Search uses the same `rankByName` ranking as every other menu query in the app, so a branch matches the way a slash command does, and the field keeps focus while ↑/↓ move the highlight and Enter or Tab settles it. The `Current HEAD` row stays pinned above the field: HEAD is not a branch — it resolves when the user sends, not now — so no query may hide the row that means “no base at all”.

<a id="understand-the-implementation"></a>
## Understand the implementation

The page owns one Settings navigation row, so it never competes with a plugin’s own configuration for space in a detail page.

Each repository group independently expands or collapses its worktree table, starting expanded on page entry. The group retains its title, count, and independent `Clean up stale entries` action while collapsed. Cleanup removes Git registrations whose checkout directories no longer exist; it does not delete existing directories. Refresh preserves the expansion state of retained groups. The Refresh button aligns vertically with the combined page title and description.

The table gives the branch and secondary directory text the remaining width. Clicking a row outside its operation buttons opens compact details; Enter or Space on the row and activating its branch button do the same. The dialog shows the full branch name once, directory, source, ignored-file count, and commit, with `Copy path` and optional `Open directory` actions. Source is hidden from the table in narrow panels but remains available in the details. Removal confirmation separates the directory, deletion impact, session-archive acknowledgement, and file-loss warning; its action footer wraps in narrow panels.

Long branch names retain their beginning and end in the table. The details show the full branch name and path without truncation.

Container queries stack row contents when the Settings panel narrows. Repository names and headings wrap. Read failures retain previously loaded rows and show an in-place error; operation results use the shell Toast.

The Session header shows only the branch beside the mode, truncating long names within a 160px control. A single hover card shows the full branch name and checkout directory, with copy and optional desktop-open actions. Clicking or tapping the branch does not open a dialog or pin the card. Keyboard focus retains the shared card's preview behavior. The composer dock does not repeat the branch.

The Remote-facing functions live in their own module rather than inside the components. That keeps a browser spec able to run against a literal face instead of the generated Remote artifact, which only exists after a build.

No component decides what the Host already decided. The page renders the arm flag and the entered checkout exactly as `state` reports them, and the checkbox and the branch line render nothing until the Host has answered — so a mount cannot flicker between armed and not, and none of them can report a checkout the Host never made.

The composer checkbox and header branch reread when a run ends, so a refused arming reports its reason and a materialized worktree updates the displayed branch and directory.

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

- **The checkbox reaches only empty Sessions** — the Host also rejects arming after a turn has started.
- **Session readings refresh between runs, not during one** — the branch, directory and arming state are re-read once when a run ends, so a checkout that moves mid-run keeps the previous name until it finishes.
- **Ignored files are separate from changes** — the page reports their count, and removal requires acknowledgement before discarding them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

`npx vitest run packages/experimental/client-ui-worktree-console` renders the components in jsdom against a literal face, so no Host or build artifact is needed.

</details>
