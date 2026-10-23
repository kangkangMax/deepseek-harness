import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The bundle's display contract with `readPluginMeta`
 * (packages/boot/app-boot/src/package-meta.ts), which the plugin page renders.
 *
 * The icon must be a relative path that stays inside the manifest directory,
 * carry an admitted image extension, and stay at most 256 KiB — and, because a
 * published tarball that omits the file would leave the page icon-less, a
 * `files` entry must ship it.
 *
 * The locale dictionary is the other half of the same contract, and its absence
 * fails in the quietest way of all: the page falls back to the package name, so
 * the card reads `@deepseek-ai/dsh-experimental-worktree-console-bundle` in a
 * list of named plugins and the feature looks missing entirely. The dictionary
 * is unreachable unless the manifest exports it, and unpublished unless
 * `files` ships it.
 */
const BUNDLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../worktree-console-bundle')
const MAX_ICON_BYTES = 256 * 1024
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

function manifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(BUNDLE_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
}

function dictionary(language: 'en' | 'zh'): { meta?: { title?: unknown; description?: unknown } } {
  const file = join(BUNDLE_ROOT, 'locale', `${language}.json`)
  return JSON.parse(readFileSync(file, 'utf8')) as { meta?: { title?: unknown; description?: unknown } }
}

describe('worktree console bundle icon', () => {
  it('declares a relative icon that stays inside the manifest directory', () => {
    const icon = manifest().icon
    expect(typeof icon).toBe('string')

    const value = icon as string
    expect(isAbsolute(value)).toBe(false)
    expect(win32.isAbsolute(value)).toBe(false)
    expect(/^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)).toBe(false)

    const local = relative(BUNDLE_ROOT, resolve(BUNDLE_ROOT, value))
    expect(local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)).toBe(false)
  })

  it('ships the icon inside the published files', () => {
    const files = manifest().files
    expect(Array.isArray(files)).toBe(true)
    // Compared by resolved path: the manifest writes `./icon.svg` while `files`
    // carries the bare `icon.svg`, the convention every icon-bearing package here follows.
    const shipped = (files as unknown[]).map(entry => resolve(BUNDLE_ROOT, String(entry)))
    expect(shipped).toContain(resolve(BUNDLE_ROOT, manifest().icon as string))
  })

  it('keeps the icon an admitted, small, well-formed image', () => {
    const target = join(BUNDLE_ROOT, manifest().icon as string)
    expect(ICON_EXTENSIONS.has(extname(target).toLowerCase())).toBe(true)

    const stat = statSync(target)
    expect(stat.isFile()).toBe(true)
    expect(stat.size).toBeLessThanOrEqual(MAX_ICON_BYTES)

    // Only the root element is asserted: the artwork itself is the icon's own business.
    expect(readFileSync(target, 'utf8').trimStart().startsWith('<svg')).toBe(true)
  })
})

describe('worktree console bundle locale dictionary', () => {
  // Without this export `readPluginMeta` cannot resolve `locale/en.json`, so the
  // dictionary's content never reaches the page no matter what the files say.
  it('exports the locale dictionaries the metadata reader resolves', () => {
    const exports = manifest().exports as Record<string, unknown> | undefined
    expect(exports?.['./locale/*.json']).toBe('./locale/*.json')
  })

  it('ships the dictionaries inside the published files', () => {
    const files = manifest().files as unknown[]
    expect(files).toContain('locale/*.json')
  })

  it('names the plugin in both shipped dictionaries', () => {
    for (const language of ['en', 'zh'] as const) {
      const meta = dictionary(language).meta
      expect(typeof meta?.title).toBe('string')
      expect((meta?.title as string).trim()).not.toBe('')
      expect(typeof meta?.description).toBe('string')
      expect((meta?.description as string).trim()).not.toBe('')
    }
  })

  // The fallback the page would otherwise show: a name that identifies no feature.
  it('does not fall back to the package name', () => {
    expect(dictionary('zh').meta?.title).not.toBe(manifest().name)
  })
})
