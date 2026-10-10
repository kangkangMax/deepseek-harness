/**
 * Public vocabulary of the worktree management console.
 *
 * Rows carry facts only: a checkout path, what Git has on record for it, and
 * which tooling appears to have placed it. The page decides presentation from
 * these; nothing here exposes the Git port or the workspace registry.
 * @module @deepseek-ai/dsh-experimental-worktree-console/src/types
 */

/** Which tooling placed one checkout, as far as its location can tell. */
export type WorktreeOrigin = 'official' | 'third-party' | 'manual'

/** One worktree as the management page reads it. */
export interface WorktreeRow {
  /** Absolute checkout directory. */
  readonly path: string
  /** Short name of the checked-out branch, or null for a detached checkout. */
  readonly branch: string | null
  /** Commit the registration currently points at. */
  readonly head: string
  /** Whether the checkout directory still exists. */
  readonly present: boolean
  /**
   * Registered without a checkout directory. `prune` is the repair; `remove`
   * refuses these because there is no directory left to remove.
   */
  readonly stale: boolean
  /** Repository-relative paths with uncommitted changes; empty when the checkout is absent. */
  readonly dirtyFiles: readonly string[]
  /** Which tooling placed this checkout, per the landing-spot table. */
  readonly origin: WorktreeOrigin
}

/**
 * One registered repository and the worktrees Git has on record for it.
 *
 * The repository's own checkout is not a row: it is the repository, Git
 * refuses to remove it, and `prune` never touches it.
 */
export interface RepositoryRows {
  /** Workspace registry id; stable while the directory exists. */
  readonly id: string
  /** Canonical repository root. */
  readonly path: string
  /** Workspace display title. */
  readonly title: string
  /** Registered worktrees, in `git worktree list` order. */
  readonly worktrees: readonly WorktreeRow[]
}

/** The page's complete read. */
export interface ConsoleSnapshot {
  /** Every registered repository, in registry order. */
  readonly repositories: readonly RepositoryRows[]
}

/** Outcome of clearing stale registrations. */
export interface PruneOutcome {
  /** Checkout paths whose stale registrations were cleared. */
  readonly pruned: readonly string[]
}

/** Outcome of removing one worktree. */
export interface RemoveOutcome {
  /** The checkout path that was removed. */
  readonly removed: string
}
