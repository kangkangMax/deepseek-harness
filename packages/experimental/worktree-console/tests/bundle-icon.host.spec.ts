import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The bundle's manifest icon, held to the constraints `readPluginMeta` enforces
 * when it inlines it for the plugin page (packages/boot/app-boot/src/package-meta.ts):
 * a relative path that stays inside the manifest directory, an admitted image
 * extension, at most 256 KiB — and, because a published tarball that omits the
 * file would leave the page icon-less, a `files` entry that ships it.
 */
const BUNDLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../worktree-console-bundle')
const MAX_ICON_BYTES = 256 * 1024
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])

function manifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(BUNDLE_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
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
