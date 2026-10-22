/** Dictionaries for the worktree management section, the composer switch, and the composer branch line. */
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
  worktreesIn: 'Worktrees in {repository}',
  worktreesEmpty: 'This repository has no worktrees.',
  selectRepository: 'Select a repository to see its worktrees.',

  branch: 'Branch',
  branchDirectory: 'Branch / directory',
  directory: 'Working directory',
  worktreeCount: '{count} worktrees',
  actions: 'Actions',
  primaryProtected: 'Primary worktree',
  lockedProtected: 'Locked worktree',
  head: 'Commit',
  changes: 'Changes',
  source: 'Source',

  detached: 'detached',
  changedCount: '{count} changed',
  ignoredCount: '{count} ignored',
  clean: 'clean',

  originOfficial: 'Official',
  originThirdParty: 'Third-party',
  originManual: 'Manual',

  primary: 'primary',
  stale: 'stale',
  staleHint: 'The registration has no checkout directory left.',
  staleCardHint:
    'Directory no longer exists — removing this row only drops the registration, not any files.',
  locked: 'locked',
  // Short because it sits in the branch cell, and the widest tag there is the
  // pixel the branch name does not get. The full phrase is the row's title.
  outsideRepository: 'outside',
  outsideRepositoryHint: 'Registered from a directory outside the repository.',

  copyPath: 'Copy path',
  copied: 'Copied',
  copyFailed: 'Could not copy the path. Try again.',
  close: 'Close',
  reveal: 'Open directory',
  revealDone: 'Opened directory.',

  refresh: 'Refresh',
  loading: 'Loading worktrees…',

  // Short because it shares a row with the repository name, and a button long
  // enough to wrap crowds that name out of the heading it belongs to. The full
  // sentence is the button's title.
  prune: 'Clean up',
  pruneHint: 'Drop registrations whose checkout directory no longer exists.',
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
  removeSessionsHint: 'Associated sessions ({count}) will be archived and hidden from the session list. Chat history will be retained.',
  removeSessionsAcknowledge: 'Also archive the associated sessions',
  removeSessionsChanged: 'Associated sessions changed. Refresh the worktrees and confirm again.',
  removeSessionsDenied: 'You need access to every associated session to remove this worktree.',
  removeSessionsFailed: 'Could not archive the associated sessions. Stop their active work and try again.',
  removeIncomplete: 'Removal did not finish; some sessions were archived. Refresh before retrying. Chat history is retained.',

  failed: 'The request failed.',
  revealFailed: 'Could not show this directory in the file manager.',

  switchLabel: 'Worktree',
  switchHint: 'Create a Git worktree for this session and work in it',
  switchArmFailed: 'Could not prepare a worktree: {reason}',
  switchBase: 'Base',
  switchBaseHint: 'Branch the new worktree starts from',
  switchBaseHead: 'Current HEAD',
  switchBaseLocal: 'Local branches',
  switchBaseRemote: 'Remote branches',
  switchBaseCurrent: '{branch} (current)',
  switchBaseSearch: 'Search branches',
  switchBaseSearchClear: 'Clear the search',
  switchBaseNoMatch: 'No branch matches that search.',
  switchBaseNoChoices: 'This repository has no branches yet.',
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
  worktreesIn: '{repository} 中的工作树',
  worktreesEmpty: '该仓库没有工作树。',
  selectRepository: '选择一个仓库以查看它的工作树。',

  branch: '分支',
  branchDirectory: '分支 / 目录',
  directory: '工作目录',
  worktreeCount: '{count} 个工作树',
  actions: '操作',
  primaryProtected: '主工作树不可删除',
  lockedProtected: '已锁定，不可删除',
  head: '提交',
  changes: '改动',
  source: '来源',

  detached: '游离',
  changedCount: '{count} 项改动',
  ignoredCount: '{count} 项已忽略',
  clean: '干净',

  originOfficial: '官方',
  originThirdParty: '第三方',
  originManual: '手动',

  primary: '主检出',
  stale: '已失效',
  staleHint: '登记还在，但检出目录已不存在。',
  staleCardHint: '目录已不存在 —— 删除这一行只会移除登记，不会删除任何文件。',
  locked: '已锁定',
  outsideRepository: '外部',
  outsideRepositoryHint: '该登记来自仓库之外的目录。',

  copyPath: '复制路径',
  copied: '已复制',
  copyFailed: '无法复制路径，请重试',
  close: '关闭',
  reveal: '打开目录',
  revealDone: '已打开目录',

  refresh: '刷新',
  loading: '正在读取工作树…',

  // Short because it shares a row with the repository name, and a button long
  // enough to wrap crowds that name out of the heading it belongs to. The full
  // sentence is the button's title.
  prune: '清理',
  pruneHint: '移除检出目录已不存在的登记。',
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
  removeSessionsHint: '将同时归档 {count} 个关联会话，并从会话列表隐藏，聊天记录会保留',
  removeSessionsAcknowledge: '同时归档关联会话',
  removeSessionsChanged: '关联会话已发生变化，请刷新工作树并重新确认',
  removeSessionsDenied: '需要有权访问所有关联会话，才能删除此工作树',
  removeSessionsFailed: '无法归档关联会话，请停止会话中正在运行的任务后重试',
  removeIncomplete: '删除未完成，部分会话已归档，聊天记录仍保留。请刷新后再重试',

  failed: '请求失败。',
  revealFailed: '无法在文件管理器中显示该目录。',

  switchLabel: '工作树',
  switchHint: '为本会话创建一个 Git 工作树并在其中工作',
  switchArmFailed: '无法准备工作树：{reason}',
  switchBase: '基线',
  switchBaseHint: '新工作树从哪个分支拉出',
  switchBaseHead: '当前 HEAD',
  switchBaseLocal: '本地分支',
  switchBaseRemote: '远程分支',
  switchBaseCurrent: '{branch}（当前）',
  switchBaseSearch: '搜索分支',
  switchBaseSearchClear: '清除搜索',
  switchBaseNoMatch: '没有匹配该搜索的分支。',
  switchBaseNoChoices: '该仓库还没有任何分支。',
  switchBaseNone: '本会话目录不在 Git 仓库中。',
}

/** Keys this plugin's dictionaries cover. */
export type WorktreeConsoleKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Worktree management section, composer switch, and composer branch line copy. */
    worktreeConsole: WorktreeConsoleKey
  }
}
