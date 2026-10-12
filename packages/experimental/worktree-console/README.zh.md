---
description: "在插件管理页列出、清理与删除已注册工作区的 Git 工作树，并让空白会话在下一个 step 进入其中一棵。读取 Git 自己的登记，因此任何工具创建过的检出都仍然可见。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-console

[English](README.md) | 中文

## 概述

在插件管理页列出、清理与删除已注册工作区的 Git 工作树，并让空白会话在下一个 step 进入其中一棵。读取 Git 自己的登记，因此任何工具创建过的检出都仍然可见。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

与 `subprocess`、`sandbox`、`fs` 和 `workspaceRegistry` 一同挂载。每个方法都是 `worktrees` 命名空间下的 Remote。

| 方法 | 用途 |
| --- | --- |
| `list()` | 每个本身是 Git 仓库根的工作区，以及 Git 为其登记的工作树。 |
| `prune(repositoryId)` | 清除检出目录已消失的登记。幂等；只报告 Git 实际清掉的部分。 |
| `removeWorktree(repositoryId, path, force)` | 删除一个工作树及其登记。未提交改动存在时除非 `force` 否则拒绝。 |
| `arm(sessionId, request)` / `disarm(sessionId)` | 设置或放弃一个意图，使该会话的下一个 step 先物化工作树。 |
| `state(sessionId)` | 武装标志、已存在的检出，以及上一次失败。 |

`arm` 需要官方 worktree 运行时已加载；缺席时 `arm` 以 `worktree/unavailable` 失败，页面其余部分照常工作。

<a id="understand-the-implementation"></a>
## 理解实现

本服务不维护自己的登记表。事实来自按需读取的「每仓库一次 `git worktree list`」，因此任何插件或手工创建的检出都可见，无需对方配合。

来源是**按路径推断**而非记录：官方插件的池是 `<仓库>/.agents/worktrees`，位于 `worktree-space` 容器下的检出归给 `dsh-worktree-space`。任何规则都不认领的检出报为 `manual` —— 一个可见的未知，而不是自信的错误答案。**所有删除动作都不读取这个标签。**

每条 git 命令都经 shell 之外执行，并关闭懒取对象、仓库钩子、文件系统监视与路径引号。沙箱围栏根是正在操作的仓库，因此共享的 `.git` 与官方池都在其中。

进入工作树是一次委托：官方运行时在创建成功的最后一步自行发布新的工作目录。

<a id="model-experience"></a>
## 模型体验

### 会话进入工作树

#### 模型可见内容

进入工作树就是一次工作目录变更：会话的当前目录上下文变为新检出，模型的文件工具据其解析。管理方法（`list`、`prune`、`removeWorktree`）不向模型上下文贡献任何内容。

#### Token 影响

每次进入产生一条目录上下文，与其它任何工作目录变更相同。列表与修复调用不增加 token。

#### KV Cache 影响

目录变更在保留的历史之后追加上下文，不替换稳定的系统提示词前缀，因此缓存前缀在切换中存活。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **来源是推断而非记录** —— 插件改变默认落点会让它的检出报为 `manual`。页面显示可见的未知而不是错误归属，且没有任何修复动作依赖这个标签。
- **围栏根是仓库** —— 从仓库之外的池登记的工作树（例如 `dsh-worktree-space` 的任务空间）会被列出，但在该围栏下无法删除。
- **被 ignore 的文件不在变更检查内** —— `git status --porcelain` 只报告已跟踪与未跟踪的改动，因此只有被 ignore 内容的检出会读作「干净」。
- **会话状态是进程内的** —— 武装意图与已进入的检出存在内存中，不跨 Host 重启。
