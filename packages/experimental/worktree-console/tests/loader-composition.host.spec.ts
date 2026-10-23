import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import WorktreeConsole from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('loads the default Service export and provides worktreeConsole', { timeout: 60_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-worktree-console-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-experimental-worktree-console'",
      '- name: fixture-observer',
      '',
    ].join('\n'))

    const seen = Promise.withResolvers<WorktreeConsole>()
    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        // The Service's own inject list, plus the Gateway binding key it is
        // constructed through. Only presence matters here; the behavior of
        // each provider is covered by the port and console specs.
        for (const service of ['typert', 'subprocess', 'sandbox', 'fs', 'workspaceRegistry', 'remoteAccess']) {
          ctx.provide(service as never, {} as never)
        }
      },
    }
    // A dependent entry resolves only after the Service entry above activated,
    // so reaching this callback proves the row itself became available.
    const observer = {
      name: 'fixture-observer',
      inject: ['worktreeConsole'],
      apply(ctx: Context) { seen.resolve(ctx.worktreeConsole) },
    }

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-experimental-worktree-console', WorktreeConsole],
      ['fixture-observer', observer],
    ])
    // Partial on the way in: the fixture supplies the two members the Loader
    // reaches for (the version tag and `import`), and says so.
    const internal: Partial<NonNullable<typeof context.loader.internal>> = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    }
    context.loader.internal = internal as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect([...context.loader.entries()].map(entry => entry.options.name))
      .toContain('@deepseek-ai/dsh-experimental-worktree-console')
    expect(await seen.promise).toBeInstanceOf(WorktreeConsole)
  })
})
