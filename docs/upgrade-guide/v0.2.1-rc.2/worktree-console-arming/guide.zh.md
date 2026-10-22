---
kind: upgrade-guide
description: "工作树管理功能要求空白会话及可用的轮次状态投影才能启用工作树意图。"
---

# 工作树管理功能要求在空白会话中启用意图

[English](guide.md) | 中文

## 变更

实验性 `worktrees/arm` Remote 会以 `worktree/session-started` 拒绝已经开始首个轮次的会话。它还要求活跃会话及其 `sessionProjections` 轮次状态；缺少状态时返回 `worktree/unavailable`。先前版本只在客户端检查会话是否为空，因此直接调用 Remote 可以为已开始的会话启用意图。

## 迁移

1. 调用 `worktrees/arm` 的自定义组合必须在官方 worktree 运行时之外提供 `sessions`、`sessionProjections` 及 agent 轮次边界投影。
2. 在发送首条消息前，为新的空白会话启用意图。对于已开始的会话，创建新会话，不要重试被拒绝的调用。
3. 确认空白会话可以成功启用，且 `worktrees/state` 的 `request` 返回已接受的意图。确认已开始的会话返回 `worktree/session-started`，工作目录不变。
