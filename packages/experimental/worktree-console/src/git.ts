/**
 * The Git port: everything the console needs from `git`, and nothing else.
 *
 * Parsing is separated from execution so the porcelain grammars can be tested
 * without a repository, and so the service layer never sees a process.
 * @module @deepseek-ai/dsh-experimental-worktree-console/src/git
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessCollectedOutputs } from '@deepseek-ai/dsh-subprocess'
import type { BranchOption } from './types.ts'

/**
 * Selectors cleared before every call. An inherited `GIT_DIR` or
 * `GIT_CONFIG_PARAMETERS` would retarget the repository or inject
 * configuration, which matters most for the commands that delete things.
 */
const CLEARED_ENV: NodeJS.ProcessEnv = Object.fromEntries([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
].map(key => [key, undefined]))

/**
 * Flags every call carries: never fetch lazily, never run a repository hook,
 * never start a filesystem monitor, and never C-quote paths.
 *
 * `core.hooksPath=/dev/null` is the load-bearing one — a worktree repair writes
 * shared Git metadata, and a hook would turn that into arbitrary code.
 * `core.quotePath=false` keeps `status` paths literal so the confirmation list
 * shows the real filename rather than an escape sequence.
 */
const HARDENED: readonly string[] = [
  '--no-lazy-fetch',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotePath=false',
]

/** Resolved resource limits for one managed command. */
export interface GitConfig {
  /** Deadline for one command, including executable lookup and confinement. */
  readonly timeoutMs: number
  /** Termination grace for the managed process. */
  readonly graceMs: number
  /** Maximum captured bytes per output stream. */
  readonly maxOutputBytes: number
  /** Git executable: a bare PATH name or an absolute execution-world path. */
  readonly gitCommand: string
}

/** One registration as `git worktree list --porcelain` reports it, before any filesystem or status work. */
export interface RegisteredWorktree {
  /** Absolute checkout directory. */
  readonly path: string
  /** Commit the registration points at. */
  readonly head: string
  /** Full ref name, or null for a detached checkout. */
  readonly branch: string | null
  /** A bare repository entry; never a worktree the page can act on. */
  readonly bare: boolean
  /** Marked `locked`; the page reports but never mutates these. */
  readonly locked: boolean
  /** Git reports the registration as prunable. */
  readonly prunable: boolean
}

/** Reads and repairs worktrees of one repository root. */
export interface GitPort {
  /**
   * @param directory - any directory.
   * @returns the canonical repository root containing it, or null when it is
   * outside every repository. Used to keep directories that merely sit next to
   * repositories out of the row list.
   */
  readonly topLevel: (directory: string, signal: AbortSignal) => Promise<string | null>
  /**
   * @param repositoryRoot - canonical repository root.
   * @returns every registration, including the repository's own checkout.
   */
  readonly list: (repositoryRoot: string, signal: AbortSignal) => Promise<readonly RegisteredWorktree[]>
  /**
   * @param repositoryRoot - canonical repository root; this, not the checkout,
   * is the fence root. `git status` refreshes the shared index under
   * `<repositoryRoot>/.git/worktrees/<name>`, which a fence rooted on the
   * checkout would deny.
   * @param worktreePath - checkout to inspect.
   * @returns what a removal would destroy: tracked and untracked changes, and
   * the ignored files a delete takes with it.
   */
  readonly status: (
    repositoryRoot: string,
    worktreePath: string,
    signal: AbortSignal,
  ) => Promise<{ changed: readonly string[]; ignored: readonly string[] }>
  /**
   * @param repositoryRoot - canonical repository root.
   * @returns after stale registrations are cleared.
   */
  readonly prune: (repositoryRoot: string, signal: AbortSignal) => Promise<void>
  /**
   * @param repositoryRoot - canonical repository root.
   * @param worktreePath - checkout to remove.
   * @param force - pass Git's `--force`, discarding uncommitted changes.
   * @returns after the checkout and its registration are gone.
   */
  readonly remove: (repositoryRoot: string, worktreePath: string, force: boolean, signal: AbortSignal) => Promise<void>
  /**
   * @param repositoryRoot - canonical repository root.
   * @returns the repository's local branches and remote-tracking refs, with the
   * local branch its own checkout has out marked. The result is the page's row
   * shape rather than a porcelain record: unlike `worktree list`,
   * `for-each-ref` needs no re-interpretation.
   */
  readonly branches: (repositoryRoot: string, signal: AbortSignal) => Promise<readonly BranchOption[]>
}

/**
 * Parse NUL-delimited `git worktree list --porcelain -z`, preserving literal paths.
 * @param stdout - command output.
 * @returns one entry per registration, in the order Git printed them.
 */
export function parseWorktreeList(stdout: string): readonly RegisteredWorktree[] {
  const entries: RegisteredWorktree[] = []
  let current: {
    path: string
    head: string
    branch: string | null
    bare: boolean
    locked: boolean
    prunable: boolean
  } | undefined
  const flush = (): void => { if (current !== undefined) entries.push(current) }
  for (const line of stdout.split('\0')) {
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice('worktree '.length), head: '', branch: null, bare: false, locked: false, prunable: false }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length).trim()
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).trim()
    else if (line === 'detached') current.branch = null
    else if (line === 'bare') current.bare = true
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true
  }
  flush()
  return entries
}

/**
 * Parse `git status --porcelain -z`.
 *
 * NUL separation is what makes this exact: a path may contain a newline, and a
 * rename record carries two paths. Quoting is off in the call, so no path
 * arrives C-escaped.
 * @param stdout - command output.
 * @returns changed paths, and the ignored paths a delete would take with them.
 */
export function parseStatusPorcelain(stdout: string): { changed: readonly string[]; ignored: readonly string[] } {
  const tokens = stdout.split('\0')
  const changed: string[] = []
  const ignored: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const entry = tokens[index]
    // `XY <path>`: two status columns and a separating space.
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    // A rename or copy record carries the source as the next token.
    if (/[RC]/.test(code)) index++
    if (code === '!!') ignored.push(path)
    else changed.push(path)
  }
  return { changed, ignored }
}

/**
 * Parse `git for-each-ref --format=%(refname)%00%(HEAD)%00%(symref) refs/heads refs/remotes`.
 *
 * The full ref name rather than `%(refname:short)`, because the namespace is
 * what tells a local branch from a remote-tracking ref and a short name has
 * already dropped it. `%(symref)` is non-empty on `refs/remotes/<remote>/HEAD`,
 * a pointer at that remote's default branch: offering it would list the same
 * revision twice, under a name no one typed. `%(HEAD)` is `*` on the ref the
 * repository's own checkout has out and a space on every other, so one call
 * answers both "which revisions exist" and "which one is the default". The NUL
 * between the fields is what keeps a branch name containing the separator out
 * of the next column.
 * @param stdout - command output.
 * @returns one option per ref, in the order Git printed them. A remote-tracking
 * ref keeps its remote prefix, so `from` gets `origin/main` and not `main`.
 */
export function parseBranchList(stdout: string): readonly BranchOption[] {
  const heads = 'refs/heads/'
  const remotes = 'refs/remotes/'
  const branches: BranchOption[] = []
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
    if (line.length === 0) continue
    const [refname, marker, symref] = line.split('\0')
    if (refname === undefined || refname.length === 0) continue
    if (symref !== undefined && symref.length > 0) continue
    const local = refname.startsWith(heads)
    if (!local && !refname.startsWith(remotes)) continue
    branches.push({
      name: local ? refname.slice(heads.length) : refname.slice(remotes.length),
      kind: local ? 'local' : 'remote',
      current: marker === '*',
    })
  }
  return branches
}

/**
 * Build the port over one context's subprocess and sandbox providers.
 *
 * Every command here is a management-page action a person asked for: the
 * arguments are built here, and the paths come from Git's own
 * `worktree list` rather than from the page. The policy the caller supplies is
 * therefore unconfined — a checkout may legitimately live in a pool outside the
 * repository, and fencing that would only make the page refuse work the user
 * explicitly requested. What an *agent* may do to a worktree is a different
 * path, owned by the plugin that creates them.
 * @param ctx - context supplying both providers in the same execution world.
 * @param config - resolved resource limits and the git executable.
 * @param policyFor - the execution policy for one repository root.
 * @returns a port whose every command is bounded and cancellable.
 */
export function createGitPort(
  ctx: Context,
  config: GitConfig,
  policyFor: (repositoryRoot: string) => SandboxExecutionPolicy,
): GitPort {
  async function runGit(
    policyRoot: string,
    cwd: string,
    args: readonly string[],
    signal: AbortSignal,
    allowedExitCodes: readonly number[] = [0],
  ): Promise<{ stdout: string; exitCode: number }> {
    const policy = policyFor(policyRoot)
    const bound = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
    const program = await ctx.subprocess.resolveExecutable(config.gitCommand, undefined, bound)
    const command = [program, ...HARDENED, ...args]
    // `confine` refuses the unconfined mode, so the already-unconfined branch
    // returns the command as-is; re-stating `mode` narrows it to the confined
    // modes the provider accepts.
    const argv = policy.mode === 'danger-full-access'
      ? command
      : (await ctx.sandbox.confine(command, { ...policy, mode: policy.mode }, bound)).argv
    bound.throwIfAborted()
    const child = ctx.subprocess.spawn({
      argv,
      cwd,
      env: { ...CLEARED_ENV, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      signal: bound,
      graceMs: config.graceMs,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: config.maxOutputBytes },
        stderr: { maxBytes: config.maxOutputBytes },
      },
    })
    try {
      const outcome = await child.done
      bound.throwIfAborted()
      // The spawn spec above collects both streams.
      const captured = child.collected as Required<SubprocessCollectedOutputs>
      const stdout = captured.stdout.readFrom(0)
      const stderr = captured.stderr.readFrom(0)
      if (outcome.exitCode === null || !allowedExitCodes.includes(outcome.exitCode)) {
        // Say which deadline expired. The bare `null` this used to print named
        // neither the fault nor the fix.
        const timedOut = bound.aborted && !signal.aborted
        const cause = timedOut
          ? `timed out after ${config.timeoutMs}ms`
          : `failed (${outcome.signal ?? String(outcome.exitCode)})`
        throw new Error(`git ${args.join(' ')} ${cause}: ${stderr.text.trim()}`)
      }
      if (stdout.lossy) throw new Error(`git ${args.join(' ')} output exceeds maxOutputBytes`)
      return { stdout: stdout.text, exitCode: outcome.exitCode }
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  }

  return {
    async topLevel(directory, signal) {
      // 128 is Git's "not a repository" status; anything else is a real fault.
      const { stdout, exitCode } = await runGit(directory, directory, ['rev-parse', '--show-toplevel'], signal, [0, 128])
      return exitCode === 0 ? stdout.replace(/\r?\n$/, '') : null
    },
    async list(repositoryRoot, signal) {
      const { stdout } = await runGit(repositoryRoot, repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], signal)
      return parseWorktreeList(stdout)
    },
    async status(repositoryRoot, worktreePath, signal) {
      // `--ignored=matching` is what keeps a "clean" checkout honest: a file
      // the repository ignores is still a file a removal deletes.
      const { stdout } = await runGit(
        repositoryRoot,
        worktreePath,
        ['status', '--porcelain', '-z', '--ignored=matching', '--untracked-files=all'],
        signal,
      )
      return parseStatusPorcelain(stdout)
    },
    async prune(repositoryRoot, signal) {
      await runGit(repositoryRoot, repositoryRoot, ['worktree', 'prune'], signal)
    },
    async remove(repositoryRoot, worktreePath, force, signal) {
      const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath]
      await runGit(repositoryRoot, repositoryRoot, args, signal)
    },
    async branches(repositoryRoot, signal) {
      // `--sort=refname` fixes the order the picker shows, so the list does not
      // reshuffle with whatever Git's default ordering happens to be; over both
      // namespaces it also puts `refs/heads/…` ahead of `refs/remotes/…`, which
      // is the order the picker groups them in anyway.
      const { stdout } = await runGit(
        repositoryRoot,
        repositoryRoot,
        ['for-each-ref', '--sort=refname', '--format=%(refname)%00%(HEAD)%00%(symref)', 'refs/heads', 'refs/remotes'],
        signal,
      )
      return parseBranchList(stdout)
    },
  }
}
