---
kind: upgrade-guide
description: "Worktree console arming requires an empty Session and available turn-state projections."
---

# Worktree console arming requires an empty Session

English | [中文](guide.zh.md)

## Change

The experimental `worktrees/arm` Remote rejects Sessions whose first turn has started with `worktree/session-started`. It also requires a live Session and its `sessionProjections` turn state; missing state returns `worktree/unavailable`. Earlier versions checked emptiness only in the client, so direct Remote callers could arm a started Session.

## Migration

1. Custom compositions using `worktrees/arm` must provide `sessions`, `sessionProjections`, and the agent turn-boundary projection alongside the official worktree runtime.
2. Arm a new, empty Session before sending its first message. For a started Session, create a new Session instead of retrying the rejected call.
3. Confirm that arming an empty Session succeeds and that `worktrees/state` returns the accepted intent in `request`. Confirm that arming a started Session returns `worktree/session-started` without changing its working directory.
