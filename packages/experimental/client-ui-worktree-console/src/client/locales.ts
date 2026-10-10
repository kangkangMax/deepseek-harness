/** Dictionaries for the worktree management section and the composer switch. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'worktreeConsole'

/** English copy. */
export const en = {
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

  refresh: 'Refresh',
  loading: 'Loading worktrees…',

  prune: 'Clean up stale registrations',
  pruneNone: 'Nothing was stale.',
  pruneDone: 'Cleared {count}.',

  remove: 'Remove',
  removeConfirm: 'Remove this worktree?',
  removeConfirmHint: 'The checkout directory is deleted and its registration dropped.',
  removeLostFiles: 'These uncommitted changes will be lost:',
  removeConfirmAction: 'Remove and discard changes',
  removeCancel: 'Cancel',
  removeDone: 'Removed {path}.',

  failed: 'The request failed.',
}

/** Chinese copy. */
export const zh: typeof en = {
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

  refresh: '刷新',
  loading: '正在读取工作树…',

  prune: '清理失效登记',
  pruneNone: '没有失效登记。',
  pruneDone: '已清理 {count} 条。',

  remove: '删除',
  removeConfirm: '确定删除这个工作树？',
  removeConfirmHint: '检出目录会被删除，登记也会被移除。',
  removeLostFiles: '以下未提交改动会丢失：',
  removeConfirmAction: '删除并丢弃改动',
  removeCancel: '取消',
  removeDone: '已删除 {path}。',

  failed: '请求失败。',
}
