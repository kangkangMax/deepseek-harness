---
kind: upgrade-guide
description: "删除工作树需要明确确认关联会话，并在删除检出前归档这些会话。"
---

# 删除工作树时确认并归档关联会话

[English](guide.md) | 中文

## 变更

实验性 `worktrees/removeWorktree` Remote 在 `force` 之后、取消信号之前接收 `confirmedSessionIds`。删除检出前先归档关联的非活动会话，保留聊天记录。先前调用只删除检出。列表行包含 `sessionIds`，读取列表和删除均需要 `sessionQuery` 及工作目录投影。

## 迁移

1. 自定义组合必须在工作区注册表之外提供 `sessionQuery` 和工作目录投影。
2. 读取行的 `sessionIds`，说明这些会话将被归档，获得确认后再将 id 传给 `removeWorktree`。没有关联会话的行传入空数组。
3. 收到 `worktree/sessions-unconfirmed` 时刷新并重新确认。重试 `worktree/session-archive-failed` 前停止运行中的任务。收到 `worktree/removal-incomplete` 时先刷新再重试；其 `archivedSessionIds` 仍保持归档，聊天记录仍可恢复。
4. 确认取消操作不会改变检出和会话，接受后检出被删除，其关联会话从普通会话列表隐藏。
