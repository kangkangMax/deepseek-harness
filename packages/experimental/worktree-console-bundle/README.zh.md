---
description: "组合工作树管理的宿主控制器与渲染它的浏览器半边。默认禁用；在插件管理页启用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-worktree-console-bundle

[English](README.md) | 中文

## 概述

组合工作树管理的宿主控制器与渲染它的浏览器半边。默认禁用；在插件管理页启用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件管理页启用「Git 工作树」。本 Bundle 自身没有配置项。

启用后，本 Bundle 自己的详情页上会出现「工作树」区块，空白会话的 composer 会出现工作树开关。

<a id="understand-the-implementation"></a>
## 理解实现

静态 `cordis.patch.yml` 插入两行：宿主控制器与浏览器半边。没有任何官方 Bundle 列出本包，因此在被启用之前一直处于关闭状态。

进入工作树还需要官方 worktree 插件已加载。缺席时管理页照常工作，开关会说明无法武装的原因。

<a id="model-experience"></a>
## 模型体验

### 会话进入工作树

#### 模型可见内容

进入工作树是宿主控制器做出的一次工作目录变更：会话的当前目录上下文变为新检出。本 Bundle 自身不增加任何模型上下文。

#### Token 影响

每次进入产生一条目录上下文，与其它任何工作目录变更相同。

#### KV Cache 影响

目录变更在保留的历史之后追加上下文，不替换稳定的系统提示词前缀，因此缓存前缀在切换中存活。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **不在随发行提供的可选 Bundle 名单里** —— 本包位于仓库内、按 profile 启用；没有任何清单枚举或自动安装它。
- **进入会话需要第二个插件** —— 只有在官方 worktree 运行时已加载时，composer 开关才能武装。
- **变更检查看不到被 ignore 的文件** —— 只有被 ignore 内容的检出会读作「干净」。

### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

本 Bundle 只负责组合：`npx vitest run packages/experimental/worktree-console-bundle` 校验它的 patch 是否启用了两半以及图标。

</details>
