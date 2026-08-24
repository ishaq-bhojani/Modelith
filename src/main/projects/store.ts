import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { ProjectMeta } from '../../shared/types.js'

interface ProjectsFile {
  projects: ProjectMeta[]
  activeId: string | null
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/** Shape guard for the parsed file — see `read`. */
function isProjectsFile(value: unknown): value is ProjectsFile {
  if (typeof value !== 'object' || value === null) return false
  const { projects, activeId } = value as Partial<ProjectsFile>
  if (!Array.isArray(projects)) return false
  return activeId === null || typeof activeId === 'string'
}

/**
 * The project list and which one is active, at `<userData>/projects.json`.
 *
 * Deliberately NOT in settings.json: this is user data, not a preference. A
 * corrupt preferences file falls back to defaults silently (nothing is lost);
 * a corrupt project list must fail loudly, because silently showing zero
 * projects looks exactly like losing them.
 */
export class ProjectStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async read(): Promise<ProjectsFile> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if (isEnoent(err)) return { projects: [], activeId: null }
      throw new Error(`Projects at ${this.filePath} could not be read: ${String(err)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Projects at ${this.filePath} is corrupt and could not be parsed.`)
    }
    // Valid JSON of the wrong shape is corruption too, and it has to be caught
    // HERE. Cast straight to ProjectsFile and a file like `{}` or `null`
    // reaches sort() as `undefined`, which throws "projects is not iterable" —
    // the one file the design says must fail loudly failing obscurely instead.
    if (!isProjectsFile(parsed)) {
      throw new Error(`Projects at ${this.filePath} is corrupt: unexpected contents.`)
    }
    return parsed
  }

  private async write(data: ProjectsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, JSON.stringify(data, null, 2))
    await rename(tmpPath, this.filePath)
  }

  /** Most recently opened first, so what you are working on stays at the top. */
  private sort(projects: ProjectMeta[]): ProjectMeta[] {
    return [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  /**
   * A `lastOpenedAt` strictly newer than every project already stored.
   *
   * `Date.now()` alone is not enough: it has millisecond resolution, and
   * creating or activating a project can easily land in the same millisecond
   * as the previous one. Two projects then tie, `sort` returns 0, and the
   * stable sort keeps the OLDER one on top — so "most recently opened first"
   * fails for the exact action the user just performed. Clamping up by one
   * makes the ordering a property of the operation rather than of how fast
   * the machine is.
   */
  private nextOpenedAt(projects: ProjectMeta[]): number {
    const newest = projects.reduce((max, p) => Math.max(max, p.lastOpenedAt), 0)
    return Math.max(Date.now(), newest + 1)
  }

  async list(): Promise<{ projects: ProjectMeta[]; activeId: string | null }> {
    const data = await this.read()
    return { projects: this.sort(data.projects), activeId: data.activeId }
  }

  async create(root: string, name?: string): Promise<ProjectMeta> {
    return this.serialize(async () => {
      const data = await this.read()
      // Picking a folder that is already a project reopens it rather than
      // creating a duplicate that would split its sessions across two groups.
      const existing = data.projects.find((p) => p.root === root)
      if (existing) {
        existing.lastOpenedAt = this.nextOpenedAt(data.projects)
        await this.write({ ...data, activeId: existing.id })
        return existing
      }
      const project: ProjectMeta = {
        id: randomUUID(),
        name: name ?? basename(root),
        root,
        createdAt: Date.now(),
        lastOpenedAt: this.nextOpenedAt(data.projects),
      }
      await this.write({ projects: [project, ...data.projects], activeId: project.id })
      return project
    })
  }

  async rename(id: string, name: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const project = data.projects.find((p) => p.id === id)
      // `root` is deliberately not settable here — see the plan's constraints.
      if (project) project.name = name
      await this.write(data)
    })
  }

  async remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const projects = data.projects.filter((p) => p.id !== id)
      const activeId = data.activeId === id ? (projects[0]?.id ?? null) : data.activeId
      await this.write({ projects, activeId })
    })
  }

  async setActive(id: string | null): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const project = data.projects.find((p) => p.id === id)
      if (project) project.lastOpenedAt = this.nextOpenedAt(data.projects)
      await this.write({ ...data, activeId: project ? project.id : null })
    })
  }

  async activeRoot(): Promise<string | null> {
    const { projects, activeId } = await this.list()
    return projects.find((p) => p.id === activeId)?.root ?? null
  }

  /**
   * The root for a given project id. Returns null for an absent id (Unfiled)
   * AND for an id that no longer exists — the state a non-destructive remove
   * leaves behind. It must never fall back to another project's folder: that
   * would silently point an agent at the wrong codebase.
   */
  async rootOf(projectId: string | undefined): Promise<string | null> {
    if (!projectId) return null
    const { projects } = await this.list()
    return projects.find((p) => p.id === projectId)?.root ?? null
  }

  static defaultPath(userDataDir: string): string {
    return join(userDataDir, 'projects.json')
  }
}
