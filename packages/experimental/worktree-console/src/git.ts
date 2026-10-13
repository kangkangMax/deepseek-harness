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

/**
 * The deepest directory containing both paths.
 *
 * A removal writes two trees at once — the shared `.git/worktrees/<name>`
 * metadata under the repository, and the checkout directory itself — and one
 * fence root has to contain both. A third-party pool may place its checkouts
 * outside the repository, and refusing those left the page showing worktrees it
 * would not touch, so the fence widens to the ancestor that covers both.
 * @param left - first absolute path.
 * @param right - second absolute path.
 * @returns their common ancestor; `/` when they share no segment at all.
 */
export function commonAncestor(left: string, right: string): string {
  const a = left.split('/')
  const b = right.split('/')
  const shared: string[] = []
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) break
    shared.push(a[index] as string)
  }
  return shared.join('/') || '/'
}

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
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Records are recognised by their `worktree ` line rather than by a blank-line
 * separator, so a trailing blank line or a `prunable <reason>` that wraps
 * cannot merge two registrations.
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
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
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
    if (code.startsWith('R') || code.startsWith('C')) index++
    if (code === '!!') ignored.push(path)
    else changed.push(path)
  }
  return { changed, ignored }
}

/**
 * Build the port over one context's subprocess and sandbox providers.
 * @param ctx - context supplying both providers in the same execution world.
 * @param config - resolved resource limits and the git executable.
 * @param policyFor - the confinement policy for one repository root.
 * @returns a port whose every command is bounded, cancellable, and confined.
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
      const { stdout } = await runGit(repositoryRoot, repositoryRoot, ['worktree', 'list', '--porcelain'], signal)
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
      // The fence root is the ancestor of both write targets, not the
      // repository alone: Git drops the registration under
      // `<repositoryRoot>/.git/worktrees/<name>` and deletes the checkout,
      // which a pool outside the repository keeps elsewhere. The command still
      // runs in the repository, and its arguments are built here.
      await runGit(commonAncestor(repositoryRoot, worktreePath), repositoryRoot, args, signal)
    },
  }
}
