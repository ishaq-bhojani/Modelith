/**
 * The primary modifier's display label for the current platform: `⌘` on macOS,
 * `Ctrl+` elsewhere. So `${modKey(platform)}N` renders `⌘N` on a Mac and
 * `Ctrl+N` on Windows/Linux — the earlier hard-coded `⌘` glyphs were wrong off
 * macOS. `platform` is `process.platform` as surfaced by the store.
 */
export function modKey(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl+'
}
