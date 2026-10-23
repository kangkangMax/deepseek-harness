/**
 * Which registered workspaces the console can operate on.
 *
 * A workspace is a directory the user registered; only those that are Git
 * repository roots carry worktrees. A directory that merely contains
 * repositories is skipped rather than scanned: searching under a workspace is
 * a different feature with a different cost profile, and the registry is small
 * enough (single digits) that the status quo is not worth the traversal.
 * @module @deepseek-ai/dsh-experimental-worktree-console/src/workspaces
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type { GitPort } from './git.ts'

/** One repository the console can operate on. */
export interface RepositoryRef {
  /** Workspace registry id. */
  readonly id: string
  /** Canonical repository root. */
  readonly path: string
  /** Workspace display title. */
  readonly title: string
}

/**
 * Read the workspace registry and keep the workspaces that are repository roots.
 * @param ctx - context owning the workspace registry.
 * @param git - port used to ask Git where each workspace's repository starts.
 * @param signal - cancellation of the registry read and the probes.
 * @returns repository references in registry order.
 */
export async function listRepositories(
  ctx: Context,
  git: GitPort,
  signal: AbortSignal,
): Promise<readonly RepositoryRef[]> {
  const repositories: RepositoryRef[] = []
  for (const workspace of ctx.workspaceRegistry.list()) {
    signal.throwIfAborted()
    const topLevel = await git.topLevel(workspace.path, signal)
    // Equality, not containment: a workspace one level above a repository is a
    // container, and listing it would attribute its children's worktrees to it.
    if (topLevel !== workspace.path) continue
    repositories.push({ id: workspace.id, path: workspace.path, title: workspace.title })
  }
  return repositories
}
