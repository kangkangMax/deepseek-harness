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
   * @returns repository-relative paths with uncommitted changes.
   */
  readonly status: (repositoryRoot: string, worktreePath: string, signal: AbortSignal) => Promise<readonly string[]>
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
 * @param stdout - command output.
 * @returns one entry per registration, in the order Git printed them.
 */
export function parseWorktreeList(stdout: string): readonly RegisteredWorktree[] {
  const entries: RegisteredWorktree[] = []
  for (const block of stdout.replaceAll('\r\n', '\n').split('\n\n')) {
    const lines = block.split('\n').filter(line => line.length > 0)
    const header = lines[0]
    if (header === undefined || !header.startsWith('worktree ')) continue
    let head = ''
    let branch: string | null = null
    let bare = false
    let locked = false
    let prunable = false
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim()
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim()
      else if (line === 'detached') branch = null
      else if (line === 'bare') bare = true
      else if (line === 'locked' || line.startsWith('locked ')) locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true
    }
    entries.push({ path: header.slice('worktree '.length), head, branch, bare, locked, prunable })
  }
  return entries
}

/**
 * Parse `git status --porcelain`.
 * @param stdout - command output, with `core.quotePath=false` so paths are literal.
 * @returns one path per changed entry; a rename reports its destination.
 */
export function parseStatusPorcelain(stdout: string): readonly string[] {
  const paths: string[] = []
  for (const line of stdout.replaceAll('\r\n', '\n').split('\n')) {
    // `XY <path>`: two status columns and a separating space.
    if (line.length < 4) continue
    const entry = line.slice(3)
    const renamed = entry.split(' -> ')
    paths.push(renamed[renamed.length - 1] ?? entry)
  }
  return paths
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
    const argv = policy.mode === 'danger-full-access'
      ? command
      : (await ctx.sandbox.confine(command, policy, bound)).argv
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
        throw new Error(`git ${args.join(' ')} failed (${outcome.signal ?? outcome.exitCode}): ${stderr.text.trim()}`)
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
      const { stdout } = await runGit(repositoryRoot, worktreePath, ['status', '--porcelain'], signal)
      return parseStatusPorcelain(stdout)
    },
    async prune(repositoryRoot, signal) {
      await runGit(repositoryRoot, repositoryRoot, ['worktree', 'prune'], signal)
    },
    async remove(repositoryRoot, worktreePath, force, signal) {
      const args = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath]
      await runGit(repositoryRoot, repositoryRoot, args, signal)
    },
  }
}
