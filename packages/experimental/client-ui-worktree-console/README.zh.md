---
description: "在 worktree-console Bundle 的详情页渲染工作树管理区块，并在 composer 工具行渲染工作树复选框。自身不贡献任何模型上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-console

[English](README.md) | 中文

## 概述

在 worktree-console Bundle 的详情页渲染工作树管理区块，并在 composer 工具行渲染工作树复选框。自身不贡献任何模型上下文。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

由 `@deepseek-ai/dsh-experimental-worktree-console-bundle` 挂载，不单独挂载。它注册两项贡献。

| 席位 | 行为 |
| --- | --- |
| `plugins.detail.section`，id `worktree-console` | 主从管理区块，只出现在该 Bundle 自己的详情页上。 |
| `conversation.input.left`，id `worktree` | composer 复选框 —— 空白会话显示可勾选的控件，已进入工作树的会话显示只读徽章。 |

两者都读 `worktrees` Remote；都不持有宿主没有的状态。

<a id="understand-the-implementation"></a>
## 理解实现

区块自己从页面 subject 判断是否属于被渲染的位置，对不是自己的 subject 返回空，因此从不与插件自身的配置争夺版面。

面向 Remote 的函数单独成模块而非写在组件里。这样浏览器 spec 可以对着一个字面 face 运行，而不必 import 只在构建后才存在的 Remote 生成物。

两个组件都不替宿主做决定。区块按 `state` 报告的原文渲染武装标志与已进入的检出；开关在宿主回答之前不渲染 —— 因此挂载不会在「已武装/未武装」之间闪，徽章也不会报告一个宿主从未创建过的检出。

<a id="model-experience"></a>
## 模型体验

### Composer 工作树复选框

#### 模型可见内容

本包不贡献任何内容。它在浏览器里渲染控件；真正的模型可见变化是宿主在武装的 step 运行时做出的工作目录切换。

#### Token 影响

没有。开关、徽章与管理表都不会进入模型请求。

#### KV Cache 影响

没有。不产生模型上下文，因此本包不会改变任何缓存前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **复选框只服务空白会话** —— 该规则由客户端不渲染该控件来保证，宿主不再复核。
- **徽章不会在同一会话内刷新** —— 宿主状态只在该控件挂载时读取，因此同一会话稍后进入的工作树要等重新挂载才出现。
- **变更检查看不到被 ignore 的文件** —— 区块只报告已跟踪与未跟踪的改动，因此只有被 ignore 内容的检出会读作「干净」。
