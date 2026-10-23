import { describe, expect, it } from 'vitest'
import { classifyOrigin, OFFICIAL_POOL } from '../src/sources.ts'

const repositoryRoot = '/repos/dsh'

describe('landing-spot classification', () => {
  it('claims the official pool', () => {
    expect(classifyOrigin(`/repos/dsh/${OFFICIAL_POOL}/brave-otter`, repositoryRoot)).toBe('official')
  })

  // The adjacent name differs by one character; a segment search would let it
  // through and mislabel a hand-made directory as the official plugin's.
  it('does not claim the adjacent `.agents/worktree` name', () => {
    expect(classifyOrigin('/repos/dsh/.agents/worktree/brave-otter', repositoryRoot)).toBe('manual')
  })

  // The pool is relative to the repository root, so the same relative path
  // under a different repository belongs to that repository, not to this one.
  it('does not claim another repository\'s official pool', () => {
    expect(classifyOrigin(`/repos/other/${OFFICIAL_POOL}/brave-otter`, repositoryRoot)).toBe('manual')
  })

  it('claims a worktree-space task checkout', () => {
    expect(classifyOrigin('/tasks/worktree-space/tt-23707/dsh', repositoryRoot)).toBe('third-party')
  })

  it('reports an unrecognized spot as manual rather than guessing', () => {
    expect(classifyOrigin('/repos/dsh/.my-own-worktrees/brave-otter', repositoryRoot)).toBe('manual')
  })
})
