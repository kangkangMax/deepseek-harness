/** Dictionaries for the worktree management section and the composer switch. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'worktreeConsole'

/** English copy. */
export const en = {
  settingsNav: 'Worktrees',
  section: 'Worktrees',
  sectionHint: 'Every Git worktree registered in your workspaces, whichever tool created it.',

  repositories: 'Repositories',
  repositoriesEmpty: 'No registered workspace is a Git repository.',

  worktrees: 'Worktrees',
  worktreesEmpty: 'This repository has no worktrees.',
  selectRepository: 'Select a repository to see its worktrees.',

  branch: 'Branch',
  head: 'Commit',
  changes: 'Changes',
  source: 'Created by',

  detached: 'detached',
  changedCount: '{count} changed',

  originOfficial: 'Official plugin',
  originThirdParty: 'Third-party plugin',
  originManual: 'Manual or unknown',

  stale: 'Missing checkout',
  staleHint:
    'The registration has no checkout directory. “Clean up stale registrations” removes it.',
  locked: 'Locked',
  outsideRepository: 'Outside this repository',

  refresh: 'Refresh',
  loading: 'Loading worktrees…',

  prune: 'Clean up stale registrations',
  pruneNone: 'Nothing was stale.',
  pruneDone: 'Cleared {count}.',

  remove: 'Remove',
  removeConfirm: 'Remove this worktree?',
  removeConfirmHint: 'The checkout directory is deleted and its registration dropped.',
  removeAcknowledge: 'I know this worktree has changes that will be lost',
  removeLostFiles: 'These uncommitted changes will be lost:',
  removeLostIgnored: '{count} ignored files will also be deleted.',
  removeConfirmAction: 'Remove and discard changes',
  removeCancel: 'Cancel',
  removeDone: 'Removed {path}.',

  failed: 'The request failed.',

  switchLabel: 'Worktree',
  switchHint: 'Create a Git worktree for this session and work in it',
  switchWorking: 'Working in {branch}',
  switchArmFailed: 'Could not prepare a worktree: {reason}',
  switchBase: 'Base',
  switchBaseHint: 'Branch the new worktree starts from',
  switchBaseHead: 'Current HEAD',
  switchBaseLocal: 'Local branches',
  switchBaseRemote: 'Remote branches',
  switchBaseCurrent: '{branch} (current)',
  switchBaseNone: 'This session’s directory is not a Git repository.',
}

/** Chinese copy. */
export const zh: typeof en = {
  settingsNav: '工作树',
  section: '工作树',
  sectionHint: '你的工作区里登记的全部 Git 工作树，无论由哪个工具创建。',

  repositories: '仓库',
  repositoriesEmpty: '没有已注册的工作区是 Git 仓库。',

  worktrees: '工作树',
  worktreesEmpty: '该仓库没有工作树。',
  selectRepository: '选择一个仓库以查看它的工作树。',

  branch: '分支',
  head: '提交',
  changes: '改动',
  source: '创建者',

  detached: '游离',
  changedCount: '{count} 项改动',

  originOfficial: '官方插件',
  originThirdParty: '第三方插件',
  originManual: '手动或未知',

  stale: '检出已丢失',
  staleHint: '登记还在但检出目录不存在。用「清理失效登记」把它清掉。',
  locked: '已锁定',
  outsideRepository: '在本仓库之外',

  refresh: '刷新',
  loading: '正在读取工作树…',

  prune: '清理失效登记',
  pruneNone: '没有失效登记。',
  pruneDone: '已清理 {count} 条。',

  remove: '删除',
  removeConfirm: '确定删除这个工作树？',
  removeConfirmHint: '检出目录会被删除，登记也会被移除。',
  removeAcknowledge: '我知道这个工作树有改动会被丢弃',
  removeLostFiles: '以下未提交改动会丢失：',
  removeLostIgnored: '另有 {count} 个被 ignore 的文件也会被删除。',
  removeConfirmAction: '删除并丢弃改动',
  removeCancel: '取消',
  removeDone: '已删除 {path}。',

  failed: '请求失败。',

  switchLabel: '工作树',
  switchHint: '为本会话创建一个 Git 工作树并在其中工作',
  switchWorking: '正在 {branch} 中工作',
  switchArmFailed: '无法准备工作树：{reason}',
  switchBase: '基线',
  switchBaseHint: '新工作树从哪个分支拉出',
  switchBaseHead: '当前 HEAD',
  switchBaseLocal: '本地分支',
  switchBaseRemote: '远程分支',
  switchBaseCurrent: '{branch}（当前）',
  switchBaseNone: '本会话目录不在 Git 仓库中。',
}

/** Keys this plugin's dictionaries cover. */
export type WorktreeConsoleKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Worktree management section and composer switch copy. */
    worktreeConsole: WorktreeConsoleKey
  }
}
