import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { AppMenu } from '../app/AppMenu.js'
import { UpdateChip } from '../app/UpdateChip.js'
import { modKey } from '../app/shortcut.js'
import { ProjectGroup } from './ProjectGroup.js'
import type { ProjectMeta } from '@shared/types'
import {
  IconArchive,
  IconLock,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconSliders,
  IconTrash,
} from '../app/icons.js'

interface SessionMeta {
  id: string
  title: string
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  tags?: string[]
  /** The project this session belongs to. Absent means Unfiled (projects spec). */
  projectId?: string
}

const DAY = 86_400_000

/** Groups by calendar day so "Today" flips at midnight, not 24h after the fact. */
function bucketOf(updatedAt: number, now: number): 'Today' | 'Yesterday' | 'Earlier' {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (updatedAt >= startOfToday) return 'Today'
  if (updatedAt >= startOfToday - DAY) return 'Yesterday'
  return 'Earlier'
}

function relativeTime(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Pinned sessions form their own section at the very top; the rest keep the
 *  date grouping. Shared by every project group (and Unfiled) so each one is
 *  bucketed exactly as the flat list used to be. */
function bucketSessions(visible: SessionMeta[], now: number): { label: string; items: SessionMeta[] }[] {
  const pinned = visible.filter((s) => s.pinned)
  const rest = visible.filter((s) => !s.pinned)
  const groups: { label: string; items: SessionMeta[] }[] = []
  if (pinned.length > 0) groups.push({ label: 'Pinned', items: pinned })
  for (const session of rest) {
    const label = bucketOf(session.updatedAt, now)
    const last = groups.at(-1)
    if (last && last.label === label) last.items.push(session)
    else groups.push({ label, items: [session] })
  }
  return groups
}

export function Sidebar(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const activeId = useAppStore((s) => s.activeSessionId)
  const select = useAppStore((s) => s.selectSession)
  const create = useAppStore((s) => s.newSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)
  const mod = modKey(useAppStore((s) => s.platform))
  const rename = useAppStore((s) => s.renameSession)
  const remove = useAppStore((s) => s.deleteSession)
  const togglePin = useAppStore((s) => s.togglePin)
  const toggleArchive = useAppStore((s) => s.toggleArchive)
  const projects = useAppStore((s) => s.projects)
  const createProject = useAppStore((s) => s.createProject)
  const moveSession = useAppStore((s) => s.moveSession)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // ⌘F / Ctrl+F focuses the filter, matching the hint rendered in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  const needle = query.trim().toLowerCase()
  const matches = (s: SessionMeta) =>
    (needle ? s.title.toLowerCase().includes(needle) : true) &&
    (showArchived ? true : !s.archived)
  const visible = sessions.filter(matches)

  const now = Date.now()
  const archivedCount = sessions.filter((s) => s.archived).length

  // Unfiled holds a session whose projectId is absent OR names a project that
  // no longer exists (e.g. left behind if an unfile-on-remove step ever
  // failed) — never dropped, and the group only renders when it has sessions.
  const projectIds = new Set(projects.map((p) => p.id))
  const unfiled = visible.filter((s) => s.projectId === undefined || !projectIds.has(s.projectId))

  const commitRename = (id: string) => {
    const title = draftTitle.trim()
    setEditingId(null)
    if (title) void rename(id, title)
  }

  const renderRow = (session: SessionMeta) => {
    const isActive = session.id === activeId
    const isEditing = session.id === editingId
    return (
      <div
        key={session.id}
        className="session-row"
        aria-current={isActive}
        role="button"
        tabIndex={0}
        onClick={() => { if (!isEditing) void select(session.id) }}
        onKeyDown={(e) => {
          if (isEditing) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void select(session.id)
          }
        }}
      >
        <div className="session-row-top">
          {isEditing ? (
            <input
              className="session-title"
              data-testid="rename-input"
              autoFocus
              value={draftTitle}
              aria-label="Session name"
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => commitRename(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(session.id) }
                if (e.key === 'Escape') { e.preventDefault(); setEditingId(null) }
              }}
            />
          ) : (
            <span className="session-title">{session.title}</span>
          )}

          {session.pinned ? <IconPin size={11} /> : null}

          {isEditing ? null : (
            <span className="row-actions">
              <button
                className="row-action"
                title={session.pinned ? 'Unpin' : 'Pin'}
                aria-label={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
                onClick={(e) => { e.stopPropagation(); void togglePin(session.id) }}
              >
                <IconPin size={13} />
              </button>
              <button
                className="row-action"
                title={session.archived ? 'Unarchive' : 'Archive'}
                aria-label={session.archived ? `Unarchive ${session.title}` : `Archive ${session.title}`}
                onClick={(e) => { e.stopPropagation(); void toggleArchive(session.id) }}
              >
                <IconArchive size={13} />
              </button>
              <button
                className="row-action"
                title="Rename"
                aria-label={`Rename ${session.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setDraftTitle(session.title)
                  setEditingId(session.id)
                }}
              >
                <IconPencil size={13} />
              </button>
              <select
                className="row-action row-action-move"
                data-testid="move-session"
                aria-label={`Move ${session.title} to a project`}
                value={session.projectId ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  void moveSession(session.id, e.target.value || null)
                }}
              >
                <option value="">Unfiled</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                className="row-action row-action-danger"
                title="Delete"
                aria-label={`Delete ${session.title}`}
                onClick={(e) => { e.stopPropagation(); void remove(session.id) }}
              >
                <IconTrash size={13} />
              </button>
            </span>
          )}
        </div>
        <span className="session-preview">{relativeTime(session.updatedAt, now)}</span>
      </div>
    )
  }

  const renderBucketed = (items: SessionMeta[]) =>
    bucketSessions(items, now).map((group) => (
      <div key={group.label}>
        <div className="session-group">{group.label}</div>
        {group.items.map(renderRow)}
      </div>
    ))

  return (
    <aside data-testid="sidebar" className="sidebar">
      <div className="sidebar-head">
        <span className="wordmark">Modelith</span>
        <span className="sidebar-head-actions">
          <button
            className="icon-button"
            data-testid="project-add"
            title="Add project"
            aria-label="Add project"
            onClick={() => void createProject()}
          >
            <IconPlus size={15} />
          </button>
          <AppMenu />
        </span>
      </div>

      <div className="sidebar-search">
        <div className="search-field">
          <IconSearch size={15} />
          <input
            ref={searchRef}
            data-testid="session-search"
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>{mod}F</kbd>
        </div>
      </div>

      <div className="sidebar-new">
        <button className="button-primary" data-testid="new-session" onClick={() => void create()}>
          <IconPlus size={15} />
          New chat
        </button>
      </div>

      <div className="session-list">
        {projects.map((project: ProjectMeta) => {
          const forProject = visible.filter((s) => s.projectId === project.id)
          return (
            <ProjectGroup key={project.id} project={project}>
              {renderBucketed(forProject)}
            </ProjectGroup>
          )
        })}

        {unfiled.length > 0 ? (
          <div data-testid="unfiled-group">
            <div className="session-group">Unfiled</div>
            {renderBucketed(unfiled)}
          </div>
        ) : null}

        {/* After the groups, not before them (review M7): with projects
            present this line is a footnote about the (empty) groups above it,
            and reading "No chats yet" on top of a list of project headings is
            simply the wrong order. On a fresh install there are no groups, so
            it still lands first. */}
        {visible.length === 0 ? (
          <p className="sidebar-empty">
            {sessions.length === 0
              ? 'No chats yet. Start one to see it here.'
              : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : null}

        {archivedCount > 0 ? (
          <button
            className="show-archived"
            data-testid="show-archived"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        ) : null}
      </div>

      <UpdateChip />

      <div className="sidebar-foot">
        <IconLock size={13} />
        <span>Keys in the OS keychain</span>
        <button
          className="icon-button"
          data-testid="open-settings"
          title="Settings"
          aria-label="Settings"
          onClick={openSettings}
        >
          <IconSliders size={16} />
        </button>
      </div>
    </aside>
  )
}
