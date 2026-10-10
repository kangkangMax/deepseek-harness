/**
 * The landing-spot table: which tooling appears to have placed a checkout.
 *
 * Source is inferred from the path, never from a registry. A registry would
 * have to sit on the creation path of every plugin, and the official runtime
 * exposes no creation event — so the page would only ever list its own
 * worktrees, which is the problem it exists to solve.
 *
 * The cost of inference is honest mislabeling: a checkout no rule claims is
 * reported as `manual`. The page then shows a visible unknown rather than a
 * confident wrong answer, and neither `prune` nor `remove` consults the label,
 * so a wrong guess cannot induce a wrong deletion.
 * @module @deepseek-ai/dsh-experimental-worktree-console/src/sources
 */

import type { WorktreeOrigin } from './types.ts'

/** The official plugin's checkout pool, relative to the repository root. */
export const OFFICIAL_POOL = '.agents/worktrees'

/** The directory segment `dsh-worktree-space` names its task-space container. */
export const WORKTREE_SPACE_CONTAINER = 'worktree-space'

/** How one convention recognizes a checkout it placed. */
interface OriginRule {
  /** Origin this rule reports. */
  readonly origin: Exclude<WorktreeOrigin, 'manual'>
  /** The convention in prose, so the table reads as documentation. */
  readonly convention: string
  /**
   * @param worktreePath - absolute checkout path as Git reports it.
   * @param repositoryRoot - canonical root of the repository that registered it.
   * @returns whether this convention placed that checkout.
   */
  readonly matches: (worktreePath: string, repositoryRoot: string) => boolean
}

/**
 * Ordered landing-spot table, most specific first.
 *
 * The official rule is an exact path prefix rather than a segment search, so
 * the adjacent name `.agents/worktree` — without the trailing `s` — does not
 * match it. The third-party rule is a segment search because its root is the
 * user's choice: `dsh-worktree-space` keeps every task's checkouts under a
 * container always named `worktree-space`, placed beside the repositories at a
 * path the user picks, so no absolute prefix is knowable here.
 */
export const ORIGIN_RULES: readonly OriginRule[] = [
  {
    origin: 'official',
    convention: `@deepseek-ai/dsh-experimental-worktree, pool <repository>/${OFFICIAL_POOL}`,
    matches: (worktreePath, repositoryRoot) => worktreePath.startsWith(`${repositoryRoot}/${OFFICIAL_POOL}/`),
  },
  {
    origin: 'third-party',
    convention: `dsh-worktree-space, pool <task space root>/${WORKTREE_SPACE_CONTAINER}/<task>/<repository>`,
    matches: worktreePath => worktreePath.split('/').includes(WORKTREE_SPACE_CONTAINER),
  },
]

/**
 * Classify one checkout's origin from its path.
 * @param worktreePath - absolute checkout path as Git reports it.
 * @param repositoryRoot - canonical root of the repository that registered it.
 * @returns the first matching convention's origin, or `manual` when none match.
 */
export function classifyOrigin(worktreePath: string, repositoryRoot: string): WorktreeOrigin {
  for (const rule of ORIGIN_RULES) {
    if (rule.matches(worktreePath, repositoryRoot)) return rule.origin
  }
  return 'manual'
}
