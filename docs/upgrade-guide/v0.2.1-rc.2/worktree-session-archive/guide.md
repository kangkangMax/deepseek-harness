---
kind: upgrade-guide
description: "Worktree removal requires explicit confirmation of associated Sessions and archives them before deleting the checkout."
---

# Worktree removal confirms and archives associated Sessions

English | [中文](guide.zh.md)

## Change

The experimental `worktrees/removeWorktree` Remote accepts `confirmedSessionIds` after `force` and before the cancellation signal. Removal archives associated inactive Sessions before deleting the checkout; chat history is retained. Earlier calls removed only the checkout. Inventory rows include `sessionIds`, and inventory and removal require `sessionQuery` with working-directory projections.

## Migration

1. Custom compositions must provide `sessionQuery` and working-directory projections alongside the Workspace registry.
2. Read the row's `sessionIds`, explain that those Sessions will be archived, and obtain confirmation before passing the ids to `removeWorktree`. Pass an empty array for a row without associated Sessions.
3. On `worktree/sessions-unconfirmed`, refresh and confirm again. Stop active work before retrying `worktree/session-archive-failed`. On `worktree/removal-incomplete`, refresh before retrying; its `archivedSessionIds` remain archived and chat history remains recoverable.
4. Confirm that cancelling leaves the checkout and Sessions unchanged, and that accepting removes the checkout and hides its associated Sessions from the ordinary session list.
