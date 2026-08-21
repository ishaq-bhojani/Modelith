import { useState } from 'react'
import { useAppStore } from '../state/store.js'
import { IconChevronDown, IconFolder, IconPencil, IconTrash } from '../app/icons.js'
import type { ProjectMeta } from '@shared/types'

/**
 * One project's heading and its sessions. Extracted from Sidebar so grouping
 * does not add another level of nesting to the file that already renders the
 * search box, the new-chat button, every session row and the footer.
 *
 * DEVIATION from task-5-brief.md: the brief's Step 4 snippet renders the row
 * as a plain `<button>`. Step 5 then asks for a `.row-actions` span (rename +
 * remove buttons) inside that same row, which would nest interactive buttons
 * inside a `<button>` — invalid HTML that breaks keyboard/AT navigation to
 * the nested controls. This instead follows the `.session-row` convention
 * already used elsewhere in Sidebar.tsx: a `div` with `role="button"` /
 * `tabIndex={0}` for activation, so the rename/remove buttons inside it stay
 * valid, separately-focusable controls. `aria-current` keeps the exact same
 * meaning either way — see task-5-report.md.
 */
export function ProjectGroup({
  project, children,
}: {
  project: ProjectMeta
  children: React.ReactNode
}): React.JSX.Element {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const renameProject = useAppStore((s) => s.renameProject)
  const removeProject = useAppStore((s) => s.removeProject)
  const openProjectFolder = useAppStore((s) => s.openProjectFolder)
  const isActive = project.id === activeProjectId

  const [isEditing, setIsEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  // Design spec (2026-08-04-projects-design.md, "Sidebar"): "Each project is
  // a collapsible group with its sessions beneath it." Expanded by default —
  // collapsing is something the user opts into, not a state a fresh install
  // (or a freshly created project) should ever start in.
  const [collapsed, setCollapsed] = useState(false)

  const commitRename = () => {
    const name = draftName.trim()
    setIsEditing(false)
    if (name && name !== project.name) void renameProject(project.id, name)
  }

  return (
    <div className="project-group" data-testid="project-group">
      <div
        className="project-row"
        data-testid="project-row"
        aria-current={isActive}
        title={project.root}
        role="button"
        tabIndex={0}
        onClick={() => { if (!isEditing) void setActiveProject(project.id) }}
        onKeyDown={(e) => {
          if (isEditing) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void setActiveProject(project.id)
          }
        }}
      >
        <button
          className="project-collapse"
          data-testid="project-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v) }}
        >
          <IconChevronDown size={12} />
        </button>

        {isEditing ? (
          <input
            className="project-name-input"
            data-testid="project-rename-input"
            autoFocus
            value={draftName}
            aria-label="Project name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { e.preventDefault(); setIsEditing(false); setDraftName(project.name) }
            }}
          />
        ) : (
          <span className="project-name">{project.name}</span>
        )}

        {isEditing ? null : (
          <span className="row-actions">
            <button
              className="row-action"
              title="Rename"
              aria-label={`Rename ${project.name}`}
              onClick={(e) => {
                e.stopPropagation()
                setDraftName(project.name)
                setIsEditing(true)
              }}
            >
              <IconPencil size={12} />
            </button>
            <button
              className="row-action"
              data-testid="project-open-folder"
              title="Open folder"
              aria-label={`Open ${project.name}'s folder`}
              onClick={(e) => {
                e.stopPropagation()
                void openProjectFolder(project.id)
              }}
            >
              <IconFolder size={12} />
            </button>
            <button
              className="row-action row-action-danger"
              data-testid="project-remove"
              title="Remove"
              aria-label={`Remove ${project.name}`}
              onClick={(e) => {
                e.stopPropagation()
                // "Remove" next to a folder name reads like it might delete the
                // folder — it doesn't. Name what actually happens.
                if (window.confirm(`Remove ${project.name}? Its chats move to Unfiled. Nothing on disk is deleted.`)) {
                  void removeProject(project.id)
                }
              }}
            >
              <IconTrash size={12} />
            </button>
          </span>
        )}
      </div>
      {/* Collapsing removes the sessions from the DOM entirely (not a CSS
          hide) so they also leave the accessibility tree, matching
          aria-expanded on the toggle above. */}
      {collapsed ? null : children}
    </div>
  )
}
