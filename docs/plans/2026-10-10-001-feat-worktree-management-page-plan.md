---
title: Worktree Management Page - Plan
type: feat
date: 2026-10-10
topic: worktree-management-page
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Worktree Management Page - Plan

## Goal Capsule

- **Objective:** 给 DeepSeek Harness 补一个 worktree 管理页，让用户在一个界面里看清所有已注册仓库的 Git worktree 及其来源，并安全地清理失效登记与删除指定 worktree。
- **Product authority:** 用户本人——dsh 的重度使用者，同时维护多个仓库、并在机器上并行使用多个 worktree 插件。单人工具，没有第二类使用者。
- **Delivery shape:** 以第三方伴生插件形式做在 dsh 仓库内，复用官方构建链，挂在插件详情页。
- **Open blockers:** 无。

---

## Product Contract

### Summary

在插件详情页里增加一个 worktree 管理页：左栏列出全部已注册仓库（带 worktree 计数），选中后右栏显示该仓库的 worktree 表，每行给出检出路径、分支、基点提交、改动状态与来源。页面提供两个操作：清理失效登记，以及删除指定 worktree（二次确认）。

### Problem Frame

官方实验性 worktree 插件只负责「创建并进入」，创建完就把检出目录与分支留在磁盘上——没有清单、没有清理、没有回收路径。同一台机器上还并存着另外两个 worktree 插件（各自有不同的落点约定）与手动创建的 worktree，结果是残留持续累积，而用户没有任何界面能看到它们。

用户当前的替代做法是逐仓库敲 `git worktree list`，再判断哪些能删，再敲 `git worktree prune` 或 `git worktree remove`。单仓库单 worktree 时这个做法够用；仓库一多、来源一杂，判断成本就超过收益。用户已明确表示命令行不便于查看与手动操作。

### Key Decisions

**列出全部 worktree 并标注来源，而不是只列本插件自己创建的。** 存量残留来自三个不同的 worktree 插件加手动创建；只列「自己的」无法解决用户真正的痛点。

**来源靠路径模式推断，不维护注册表。** 官方 worktree 有稳定落点（仓库根下的 `.agents/worktrees/`），第三方各有自己的落点约定，因此来源可以在无状态的前提下推断出来。代价是任何插件改变默认落点都会让该来源降级为「手动或未知」。选择它是因为自建注册表要求挂进创建路径，而官方运行时不向外暴露创建事件。

**remove 允许强删，但必须二次确认并列出会丢失的文件。** 存量残留往往带着未提交改动，一律拒绝删除会让页面失去价值。作为交换，确认步骤必须具体到文件名，而不是一句泛泛的「此操作不可撤销」。

**主从式布局，右栏承载详情。** 仓库数量少时读起来清楚，且页面高度恒定——仓库变多不会把页面拉长。

```mermaid
flowchart LR
  subgraph Page["插件详情页 · Git 工作树"]
    Left["左栏 · 仓库列表<br/>仓库名 + worktree 计数"]
    Right["右栏 · 选中仓库<br/>清理失效登记<br/>worktree 表"]
  end
  Left -->|选择仓库| Right
```

**页面挂在插件详情页，作用域是全部已注册仓库。** 插件详情页是全局设置区，没有「当前会话」上下文，因此不提供「只看当前仓库」的快捷视图；用户通过左栏切换仓库。

### Key Flows

- F1. 查看与清理
  - **Trigger:** 用户打开插件详情页。
  - **Steps:** 枚举全部已注册仓库；逐仓库读取 worktree 列表与改动状态；归类每条的来源；渲染左栏计数与右栏表格。
  - **Outcome:** 用户一眼看到全部 worktree、各自来源、以及是否干净。
  - **Covers:** R1–R6

- F2. 删除一个 worktree
  - **Trigger:** 用户在右栏某行触发删除。
  - **Steps:** 先查该条是否干净；干净则直接进入确认，不干净则在确认里列出会丢失的文件；用户确认后执行删除。
  - **Outcome:** 目标 worktree 被移除，其他 worktree 与仓库主检出不受影响。
  - **Covers:** R7–R10

### Requirements

**列表与呈现**

- R1. 页面列出全部已注册 workspace 所对应的仓库，并给出每个仓库的 worktree 数量。
- R2. 左栏为仓库列表，右栏为当前选中仓库的 worktree 表；页面高度不随仓库数量增长。
- R3. 每个 worktree 行显示：检出路径、分支名（脱离 HEAD 时明确标注）、基点提交、是否有未提交改动。
- R4. 仓库没有任何 worktree 时，右栏给出明确的空状态，而不是空白。

**来源标注**

- R5. 每个 worktree 行标注来源，取值至少覆盖：官方 worktree 插件、第三方 worktree 插件、手动或未知。
- R6. 来源判定依据检出路径的落点约定，不要求用户手工登记。

```mermaid
flowchart TB
  P["worktree 检出路径"] --> Q{"落在仓库根的 .agents/worktrees/ ?"}
  Q -->|是| A["来源 = 官方 worktree 插件"]
  Q -->|否| R{"匹配已知第三方落点约定 ?"}
  R -->|是| B["来源 = 第三方 worktree 插件"]
  R -->|否| C["来源 = 手动或未知"]
```

**操作**

- R7. 每个仓库提供「清理失效登记」操作：移除那些检出目录已不存在的 worktree 登记，不触碰任何现存目录。
- R8. 每个 worktree 行提供删除操作；执行前必须二次确认。
- R9. 目标 worktree 有未提交改动时，确认内容必须列出会丢失的具体文件。
- R10. 删除一个 worktree 不得影响同仓库其他 worktree、仓库主检出，或该 worktree 所属分支在其他检出的可用性。

**集成与可达性**

- R11. 页面出现在插件详情页内，并跟随官方 worktree 插件那一项的启用状态。
- R12. 页面数据在打开时读取，并提供手动刷新入口；不要求实时推送。

### Acceptance Examples

- AE1. 删除一个干净的 worktree
  - **Given:** 选中的仓库里有一个无未提交改动的 worktree。
  - **When:** 用户在该行触发删除并确认。
  - **Then:** 该 worktree 的检出目录与登记都消失，同仓库其他行不变。
  - **Covers:** R8, R10

- AE2. 删除一个脏 worktree
  - **Given:** 目标 worktree 有 3 个未提交改动。
  - **When:** 用户在该行触发删除。
  - **Then:** 确认内容列出这 3 个文件；用户取消则无任何变化；用户确认后 worktree 被移除且改动丢失。
  - **Covers:** R9

- AE3. 失效登记的清理
  - **Given:** 一个 worktree 的检出目录已被手工删除，但登记仍在。
  - **When:** 用户触发清理失效登记。
  - **Then:** 该登记消失，其他现存 worktree 与目录均不受影响。
  - **Covers:** R7

- AE4. 来源误标是可见的
  - **Given:** 某个第三方插件把 worktree 建在了非约定落点。
  - **When:** 页面渲染该行。
  - **Then:** 该行来源显示为「手动或未知」，而不是被错标成另一个插件的产物。
  - **Covers:** R5, R6

### Success Criteria

- 用户不再需要打开终端就能回答「这台机器上有哪些 worktree、谁建的、能不能删」。
- 存在误标时是可见的误标（落到「手动或未知」），而不是错误的自信标注——误标不会诱导用户误删。
- 清理失效登记是幂等的：重复执行不产生变化也不报错。

### Scope Boundaries

- 不创建 worktree——官方工具已提供，且创建需要会话上下文。
- 不做验收 / apply / 合并 / 退回流程——这是独立的一大块 Git 语义，官方运行时也明确不拥有合并策略。
- 不做定时或自动清理——清理由用户按需触发。
- 不做跨机器或远端仓库的 worktree 管理。

#### Deferred to Follow-Up Work

- 来源判定的兜底信号（例如以 `.git/worktrees/<name>` 的命名特征或检出的创建时间补充推断）。本计划只做落点表；未知落点落「手动或未知」是已接受的降级。
- 已注册仓库数量增长后的懒加载或缓存。当前规模下按需全量扫描足够。
- 浏览器端到端流程的自动化测试。本计划的验证止于人工在浏览器里走一遍。

### Dependencies / Assumptions

- **版本线约束:** 官方实验性 worktree 只存在于 `0.2.1-alpha.2` 线，页面必须跑在该线上。
- **Git 版本:** 目标环境的 Git 需支持 `--no-lazy-fetch`（本机 2.50.1 满足）。
- **仓库规模假设:** 已注册 workspace 为个位数（当前环境 2 个）。数量增长到数十个后，「打开页面即全量扫描」会变慢，届时需要懒加载或缓存。
- **沙箱假设:** 读取与删除 worktree 的 Git 操作需落在会话写策略允许的范围内。
- **落点约定假设:** 来源判定依赖各插件当前的默认落点；约定变化会使来源降级为「手动或未知」。

### Sources / Research

- 官方 worktree 子系统与包边界（`dsh-v0.2.1-alpha.2` 内容）: `docs/subsystems/worktrees.zh.md`、`packages/experimental/worktree/README.zh.md`、`packages/experimental/tool-worktree/README.zh.md`。
- 官方包的能力缺口原句: `.agents/notes/implemented/feature/2026-09-13-explicit-worktree-creation.zh.md`——「该服务不拥有工作树注册表、清理计划、分支合并策略或任务关联数据库」。
- 官方默认落点与忽略文件写入条件: `packages/experimental/worktree/src/index.ts`（`directory` 默认 `.agents/worktrees`）、`packages/experimental/worktree/src/directory.ts`。
- 页面挂载点契约: `packages/client/ui-plugin-manager/src/client/slot-contract.ts` 声明 `plugins.detail.section`，其 subject 联合为 `{kind:'bundle',pkg}` / `{kind:'row',pkg,row}` / `{kind:'item',id}`；用法见 `docs/cookbook/adding-a-settings-card.zh.md` 第 4 节。
- 客户端半边的构建约束: `docs/cookbook/adding-a-settings-card.zh.md` 第 5 节；产物格式由 `packages/client/tsdown.client.ts` 的 `clientBundle` 预设决定，该预设不随任何已发布包发布。
- 远程契约通路: `docs/cookbook/adding-a-remote-api.zh.md` 的五步法，含 `TypertRemoteService` 与 `RemoteError` 码表约定。
- 插件形态与扩展点总览: `docs/cookbook/extension-cookbook.zh.md`。
- 「仓库内、不随官方发行」的可选 bundle 先例: `packages/experimental/voice-input-bundle/cordis.patch.yml`（`- insert` 列出全部件）与其 `package.json`（`dsh.bundle.patch` + `workspace:*` 依赖），配合 `packages/experimental/client-ui-voice-input`。实测三个 `packages/experimental/client-ui-*` 均不在 `packages/bundle/web-app/cordis.patch.yml`。
- 客户端包的构建配置形状: `packages/experimental/client-ui-voice-input/tsdown.config.ts`（`clientBundle('<包名>', ['lib/types/index.js'])`）与其 `package.json` 的 `dsh.client`（含 `external` 数组）。
- 已注册仓库的枚举来源: `ctx.workspaceRegistry`（`packages/api/workspace-controller`）。
- 做完整客户端半边的第三方先例（结构参考）: `dsh-git-worktree`。
- 包清单与注册面的硬性约束: `docs/cookbook/adding-a-package.zh.md`、`packages/client/AGENTS.md` 的 New plugin package checklist、`scripts/check-workspace-constraints.ts`。

---

## Planning Contract

### High-Level Technical Design

三个包构成一个可选的实验性 bundle，照搬 `voice-input-bundle` 的形状：

- **host 服务包**（`packages/experimental/worktree-console`）：一个继承 `TypertRemoteService` 的 Cordis 服务，namespace 取 `worktreeConsole`，把「枚举仓库 → 读 worktree → 归类来源 → 执行 prune/remove」暴露为远程方法，也是所有 Git 操作的落点，经 `ctx.subprocess` 执行。它同时拥有 typert 契约。
- **客户端 UI 包**（`packages/experimental/client-ui-worktree-console`）：纯客户端半边，`dsh.client` + `./client`，用 `ctx.slots.register` 往 `plugins.detail.section` 注入管理区块并消费 host 的远程方法。它没有自己的 typert 入口。
- **聚合 bundle**（`packages/experimental/worktree-console-bundle`）：只有 `cordis.patch.yml` 与依赖声明，把上面两个包以 `- insert` 一次挂上。

数据流单向：页面打开（或手动刷新）→ 调 host 的 list → host 枚举 `ctx.workspaceRegistry` 里的仓库，逐仓库跑 `git worktree list --porcelain` 并读每条的改动状态 → 按落点表归类来源 → 返回结构化行 → 页面渲染。两个动作走同一通路。

### Key Technical Decisions

**KTD-1. 拆三个包，跟随实验区既有的可选 bundle 先例。** 仓库里两种形态都有先例（`packages/experimental/*` 拆成「客户端包 + bundle 包」，`packages/client/ui-plugin-manager` 是单包双半边）。选拆包因为它落在实验区惯例内，并且天然给出「不进官方发行面」的位置。

**KTD-2. 不进 `OPTIONAL_BUNDLES`，也不注册进 web-app bundle。** 因此它不随官方发行，也不会在插件管理器里出现官方开关；启用方式是写进目标 profile 的 `dsh.profile.bundles`。这条是本计划与「官方收录」的分界线，改动它需要重新评估三处注册面。

**KTD-3. 来源判定用内置落点表，未知落点落「手动或未知」。** 官方落点是 `<仓库根>/.agents/worktrees/`；已知第三方落点按各自当前默认前缀匹配；其余一律「手动或未知」。这是唯一能满足「区分第三方与手动」的做法，代价是对方改落点即降级——已作为可接受的降级记入 Deferred。

**KTD-4. Git 操作沿用第三方先例的硬化参数集与沙箱子进程。** 不自己发明调用约定：禁用可选锁、禁用仓库配置的钩子、固定 C locale、清掉调用方的 Git 路由环境变量、设超时与输出上限。理由是这个组合已知能在 dsh 的子进程与沙箱下工作。

**KTD-5. 删除前的改动检查是删除的必要前置，不是可选提示。** 先读改动状态，再据此决定确认内容；取消必须无副作用。

**KTD-6. 保留主从布局，不为仓库数量少做单栏降级。** brainstorm 已选定主从；把它变成实施期判断会在没有数据支撑的情况下抖动界面形态。

**KTD-7. 测试止于包级单元与组件测试。** host 侧用真实临时 Git 仓库（`git init` + `git worktree add`）而不是 mock git 输出——来源判定与失效登记这两类逻辑的错法都藏在真实输出格式里；浏览器端到端不引入。

### Sequencing

U1 先落地骨架与装配面（没有它，后面任何验证都没有落点）。U2 与 U3 相互独立，可在 U1 之后并行。U4 依赖 U2、U3 的产物形状。U5 依赖 U4 的契约。U6 收口构建与本地挂载验证。

---

## Implementation Units

### U1. 三包骨架与装配面

- **Goal:** 建立 host 包、客户端 UI 包、聚合 bundle 三个包的清单与构建配置，使 bundle 能被 profile 装载出条目。
- **Files:** `packages/experimental/worktree-console/package.json`、`packages/experimental/client-ui-worktree-console/package.json`、`packages/experimental/client-ui-worktree-console/tsdown.config.ts`、`packages/experimental/client-ui-worktree-console/src/css-modules.d.ts`、`packages/experimental/worktree-console-bundle/package.json`、`packages/experimental/worktree-console-bundle/cordis.patch.yml`、`tsconfig.host.json`、`tsconfig.client.json`。
- **Patterns:** 照抄 `packages/experimental/client-ui-voice-input`（exports / `dsh.client` / `tsdown.config.ts` 的 `clientBundle` 调用）与 `packages/experimental/voice-input-bundle`（`dsh.bundle.patch` + `- insert` 列表 + `workspace:*` 依赖）。
- **Test Scenarios:** 一个 host 侧 spec 断言 Loader 组合后存在预期的条目 id，且 mock 的 `worktreeConsole` 服务可被取到（方法体可先为空）。
- **Verification:** `pnpm run typecheck` 通过；`--dump-default-config` 输出里能看到 bundle 的条目。

### U2. Git 适配层

- **Goal:** 一个可测的 git 端口，产出结构化 worktree 行，并提供 prune 与 remove 两个写操作。
- **Files:** `packages/experimental/worktree-console/src/git.ts`、`packages/experimental/worktree-console/src/types.ts`、`packages/experimental/worktree-console/tests/git.host.spec.ts`。
- **Patterns:** KTD-4 的硬化参数集；进程句柄与输出经 `ctx.subprocess`。
- **Test Scenarios:** 临时仓库上 `git worktree add` 后读到该行且字段正确；手工删掉检出目录后再读，该行被识别为失效登记且 prune 只清它；对有未提交改动的 worktree 读到具体改动文件列表；路径不存在时返回空而不抛错。
- **Verification:** `npx vitest run packages/experimental/worktree-console/tests/git.host.spec.ts` 全绿。

### U3. 仓库枚举与来源判定

- **Goal:** 从已注册 workspace 得到仓库清单，并按落点表给每个 worktree 归类来源。
- **Files:** `packages/experimental/worktree-console/src/workspaces.ts`、`packages/experimental/worktree-console/src/sources.ts`、`packages/experimental/worktree-console/tests/sources.host.spec.ts`。
- **Patterns:** 经 `ctx.workspaceRegistry` 取仓库（以 `packages/api/workspace-controller` 的公开面为准）；落点表是一张可读的前缀表，不是散落的 if。
- **Test Scenarios:** 官方落点 → 官方；每个已知第三方落点 → 第三方；未知落点 → 手动或未知；`.agents/worktrees` 与 `.agents/worktree` 这类相邻前缀不互相误匹配；无 worktree 的仓库产出空表而非缺项。
- **Verification:** `npx vitest run packages/experimental/worktree-console/tests/sources.host.spec.ts` 全绿。

### U4. 远程契约

- **Goal:** 把 list / prune / remove 暴露为远程方法，并给出可断言的失败码。
- **Files:** `packages/experimental/worktree-console/src/index.ts`、`packages/experimental/worktree-console/tests/worktree-console.host.spec.ts`。
- **Patterns:** `docs/cookbook/adding-a-remote-api.zh.md` 的五步法；`TypertRemoteService` + `@Remote`；失败统一走 `RemoteError` 与 declare merging 的码表，不建域异常家族。
- **Test Scenarios:** remove 一个不存在的目标 → 断言失败码与 details；remove 一个脏目标而未经确认 → 断言被拒绝且仓库无变化；list 在空仓库上返回空数组而不是失败。
- **Verification:** `pnpm run typecheck` 通过（host 与 client 两个 program）；`npx vitest run packages/experimental/worktree-console/tests/worktree-console.host.spec.ts` 全绿。

### U5. 客户端管理区块

- **Goal:** 在插件详情页渲染主从管理区块，含来源标签、prune 与带确认的 remove。
- **Files:** `packages/experimental/client-ui-worktree-console/src/client/index.tsx`、`packages/experimental/client-ui-worktree-console/src/client/slot-contract.ts`、`packages/experimental/client-ui-worktree-console/tests/console.client.spec.tsx`。
- **Patterns:** 照抄 `packages/client/ui-plugin-manager/src/client/` 的 slots 注册与 subject 过滤；对不属于官方 worktree bundle 的 subject 返回 `null`；远程结果判 `code` 而非 `instanceof`。
- **Test Scenarios:** 列表渲染出仓库计数与行字段；空仓库渲染空状态；脏行确认里出现具体文件列表；取消确认后不发出写调用；来源标签三种取值各自渲染正确。
- **Verification:** `npx vitest run packages/experimental/client-ui-worktree-console/tests/console.client.spec.tsx` 全绿。

### U6. 构建产物与本地挂载验证

- **Goal:** 产出可被客户端模块系统加载的半边，并把 bundle 挂进目标 profile 后人工验证。
- **Files:** `packages/experimental/client-ui-worktree-console/tsdown.config.ts`、`packages/experimental/worktree-console-bundle/cordis.patch.yml`、目标 profile 的 `package.json`。
- **Patterns:** `dsh.client.external` 只登记超出客户端基线模块表的说明符；`clientBundle` 预设产出的 lazy-CJS 工厂格式不做手工改动。
- **Test Scenarios:** 构建后 `lib/client.js` 存在；`--dump-default-config` 出现三个条目且无报错；在目标 profile 上启动后插件详情页可见管理区块，并对一个仓库执行 list 与 prune。
- **Verification:** `pnpm run build:lib` 成功且产物齐全；上面的人工走查通过。

---

## Verification Contract

| 命令 | 覆盖单元 | 通过信号 |
|---|---|---|
| `pnpm run typecheck` | U1–U5 | 退出码 0，host 与 client 两个 program 都过 |
| `npx vitest run packages/experimental/worktree-console packages/experimental/client-ui-worktree-console` | U2–U5 | 全部 spec 通过 |
| `pnpm run lint` | 全部 | 退出码 0 |
| `pnpm run build:lib` | U6 | 产出 `lib/client.js` 与 typert 产物 |
| `dsh --profile <目标 profile> --dump-default-config` | U1, U6 | 输出含 bundle 的条目 |
| 人工走查（目标 profile 启动后） | U5, U6 | 管理区块可见；list / prune 生效；脏目标删除前列出文件 |

---

## Definition of Done

- 三个包的 `typecheck`、`lint`、单元与组件测试全部通过。
- `--dump-default-config` 在目标 profile 上输出预期条目，无加载报错。
- 人工走查覆盖：列表与来源标签正确、空状态、prune 幂等、干净删除、脏删除的确认内容与取消无副作用。
- 官方发行面未被触碰：`packages/bundle/web-app/cordis.patch.yml` 与 `packages/bundle/web-app/package.json` 无改动，`OPTIONAL_BUNDLES` 未新增条目。
- 产品合同中的四条验收示例在人工走查里各被走过一次。
- 本计划记录的新增骨架事实（可选 bundle 先例、客户端包构建形状、`ctx.workspaceRegistry`）在 `### Sources / Research` 里可查。
