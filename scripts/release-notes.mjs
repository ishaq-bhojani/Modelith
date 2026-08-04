/**
 * Builds the body of a GitHub release: a download table, the first-launch
 * warning, and this version's section of CHANGELOG.md.
 *
 * Why it exists: GitHub sorts release assets alphabetically, so the three
 * `latest*.yml` files — update metadata no human should ever download — sit at
 * the very top of the list. A Windows user's first three options were Linux
 * metadata, Mac metadata and Windows metadata. Nothing on the page said which
 * of the five installers was theirs.
 *
 * The notes come from CHANGELOG.md rather than being written twice, so the
 * release page and the changelog cannot drift.
 *
 * Usage: node scripts/release-notes.mjs <version>   (e.g. 0.4.0)
 * Falls back to GITHUB_REF_NAME with any leading `v` stripped.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const version = (process.argv[2] ?? process.env['GITHUB_REF_NAME'] ?? '').replace(/^v/, '').trim()
if (!version) {
  console.error('release-notes: no version given (pass one, or set GITHUB_REF_NAME)')
  process.exit(1)
}

/**
 * The section for this version, from its `## x.y.z` heading up to the next
 * `## ` heading. Returns null when the version has no entry — the caller
 * decides whether that is fatal.
 */
async function changelogSection(v) {
  const md = await readFile(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const lines = md.split(/\r?\n/)
  // `## 0.4.0 — 2026-08-04`. Anchored so 0.4.0 cannot match 0.4.0-rc1, and the
  // dot is escaped so it cannot match 0x4y0.
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${v.replace(/\./g, '\\.')}\\b`).test(l))
  if (start === -1) return null

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s/.test(l))
  return rest.slice(0, end === -1 ? rest.length : end).join('\n').trim()
}

/**
 * Filenames are built from the version rather than read off the release,
 * because this runs before the assets are attached. They must match
 * electron-builder.yml's artifactName settings exactly — if you change one,
 * change the other, or the table will point at files that do not exist.
 */
function downloadTable(v) {
  return `### Download

| Your system | File |
|---|---|
| **Windows** | \`Modelith-Setup-${v}.exe\` |
| Windows — portable, no installer | \`Modelith-${v}-win.zip\` |
| **macOS — Apple Silicon** (M1–M4) | \`Modelith-${v}-arm64.dmg\` |
| **macOS — Intel** | \`Modelith-${v}-x64.dmg\` |
| **Linux** | \`Modelith-${v}.AppImage\` |

Not sure which Mac? Apple menu → **About This Mac**. "Apple M1/M2/M3/M4" means Apple Silicon; "Intel" means Intel. An Intel build runs on Apple Silicon under Rosetta, but an Apple Silicon build will **not** launch on an Intel Mac.

**On first launch:** these builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn you. Windows: *More info → Run anyway*. macOS: right-click the app → *Open*. Signed builds are on the roadmap.

The \`latest.yml\`, \`latest-linux.yml\` and \`latest-mac.yml\` files are update metadata for the in-app updater — you do not need to download them.`
}

const section = await changelogSection(version)
if (!section) {
  // Not fatal: a release can legitimately be cut before the changelog is
  // written. The download table is the part users need, so still emit it.
  console.error(`release-notes: no CHANGELOG.md section for ${version} — emitting the download table only`)
}

process.stdout.write(
  section
    ? `${downloadTable(version)}\n\n---\n\n## What's changed\n\n${section}\n`
    : `${downloadTable(version)}\n`,
)
