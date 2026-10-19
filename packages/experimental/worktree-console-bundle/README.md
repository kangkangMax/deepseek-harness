---
description: "Compose the worktree management Host controller with the browser half that renders it. Disabled by default; enable it from the Plugins page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-worktree-console-bundle

English | [中文](README.zh.md)

## Summary

Compose the worktree management Host controller with the browser half that renders it. Disabled by default; enable it from the Plugins page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable "Git worktrees" from the Plugins page. The bundle has no configuration of its own.

Once enabled, a "Worktrees" section appears on this bundle's own detail page, and an empty Session's composer gains a worktree switch.

<a id="understand-the-implementation"></a>
## Understand the implementation

The static `cordis.patch.yml` inserts two rows: the Host controller and the browser half. No official bundle lists this package, so it stays off until it is switched on here.

Entering a worktree needs the official worktree plugin to be loaded as well. Without it the management page still works and the switch reports why it cannot arm.

<a id="model-experience"></a>
## Model Experience

### Session worktree entry

#### What the model sees

Entering a worktree is a working-directory change made by the Host controller: the Session's `Current working directory` context becomes the new checkout. This bundle adds no model context of its own.

#### Token effect

One directory context entry per entry, the same as any other working-directory change.

#### KV Cache effect

The directory change appends context after retained history rather than replacing the stable system-prompt prefix, so the cached prefix survives.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Not listed among the shipped optional bundles** — this package lives in the repository and is enabled per profile; nothing enumerates or auto-installs it.
- **Entering a Session needs a second plugin** — the composer switch only arms when the official worktree runtime is loaded.
- **The change check cannot see ignored files** — a checkout whose only content is ignored reads as clean.

### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

This bundle is composition only: `npx vitest run packages/experimental/worktree-console-bundle` checks that its patch enables both halves and their icon.

</details>
