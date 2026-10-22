---
description: "在设置页列出、清理和删除已注册工作区的 Git 工作树，并设置空白会话在下一个 step 进入工作树。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-console

[English](README.md) | 中文

## 概述

在设置页列出、清理与删除已注册工作区的 Git 工作树，并让空白会话在下一个 step 进入其中一棵。读取 Git 自己的登记，因此任何工具创建过的检出都仍然可见。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

与 `subprocess`、`sandbox`、`fs` 和 `workspaceRegistry` 一同挂载。每个方法都是 `worktrees` 命名空间下的 Remote。

| 方法 | 用途 |
| --- | --- |
| `list()` | 每个本身是 Git 仓库根的工作区，以及 Git 为其登记的全部工作树 —— 包含仓库自己的检出，其 `primary` 为真。 |
| `prune(repositoryId)` | 清除检出目录已消失的登记。幂等；只报告 Git 实际清掉的部分。 |
| `removeWorktree(repositoryId, path, force, confirmedSessionIds)` | 归档已确认的关联会话，再删除工作树及其登记。拒绝未确认的会话、运行中的会话，以及未设置 `force` 时的脏文件。主检出受到保护。 |
| `arm(sessionId, request)` / `disarm(sessionId)` | 设置或放弃一个意图，使该会话的下一个 step 先物化工作树。 |
| `state(sessionId)` | 武装标志、启用时已接受的 `request`、已存在的检出，以及上一次失败。 |
| `branches(sessionId)` | 会话目录所属的仓库及其本地分支，供 composer 的基点选择器使用。仓库为 null 表示该目录不在任何仓库内。 |

`arm` 需要官方 worktree 运行时、活跃会话及其 `sessionProjections` 轮次状态。缺少提供者或轮次状态时以 `worktree/unavailable` 失败；已经开始过轮次的会话以 `worktree/session-started` 失败。其余管理方法保持可用。

`branches` 为页头分支控件和输入框基点选择器报告会话当前目录所属仓库。存在 `sessionQuery` 时，可释放的只读观察提供持久化工作目录投影，不启动 Agent。缺少该服务时，方法通过 `sessions` 读取已附加的会话。缺少 `workingDirectory` 的组合会报告没有仓库，而不是拒绝激活；不存在或不可读取的会话会报告错误。

`list` 和 `removeWorktree` 需要 `sessionQuery` 及工作目录投影。每行的 `sessionIds` 标识当前目录位于检出或其子目录中、调用者有权访问的未归档会话，包括宿主重启后的持久化会话。删除时重新检查关联，要求有权访问所有关联会话，并明确确认每个 id。新增关联会在任何归档或删除前返回 `worktree/sessions-unconfirmed`。文件丢失仍需单独确认。

归档保留聊天记录，并使用工作区注册表的持久化归档和活动检查。归档失败会阻止删除检出。如果后续归档或 Git 操作失败，`worktree/removal-incomplete` 会报告已归档的 id；这些归档保留，调用者必须刷新后再重试。失效行遵循相同的确认和归档规则。`prune` 只清除 Git 登记，不归档会话。

<a id="understand-the-implementation"></a>
## 理解实现

本服务不维护自己的登记表。事实来自按需读取的「每仓库一次 `git worktree list`」，因此任何插件或手工创建的检出都可见，无需对方配合。

来源是**按路径推断**而非记录：官方插件的池是 `<仓库>/.agents/worktrees`，位于 `worktree-space` 容器下的检出归给 `dsh-worktree-space`。任何规则都不认领的检出报为 `manual` —— 一个可见的未知，而不是自信的错误答案。**所有删除动作都不读取这个标签。**

Git 命令不经过 shell，也不受沙箱约束，并关闭懒取对象、钩子及文件系统监视。工作树列表使用 NUL 分隔路径。Git 的首条登记标识主检出，即使已注册工作区本身是链接检出也不例外。状态读取失败会拒绝整个列表读取，而非将无法检查的检出报告为干净。

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
- **页面自己发的 git 命令不设围栏** —— 它们是用户手动要求的操作，参数由本包构造、路径来自 `git worktree list` 回读，因此沙箱接缝根本不会被调用；agent 能对工作树做什么是另一条路径，有自己的策略。
- **已忽略文件与改动分开报告** —— 列表包含已忽略路径，未确认的删除会拒绝丢弃它们。
- **会话状态是进程内的** —— 武装意图与已进入的检出存在内存中，不跨 Host 重启。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

`npx vitest run packages/experimental/worktree-console` 用临时目录中的真实 Git 仓库验证本包，无需 API key。

</details>
