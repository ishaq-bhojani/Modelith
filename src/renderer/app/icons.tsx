/**
 * Icon set transcribed from the Claude Design project "Open Coder Desktop
 * Redesign". All icons are 24×24 line icons drawn with `currentColor`, so they
 * inherit the surrounding text colour and need no per-theme variants.
 */

interface IconProps {
  size?: number
  strokeWidth?: number
}

function Svg({
  size = 16,
  strokeWidth = 1.7,
  children,
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const IconPanel = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.6}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M10 4v16" />
  </Svg>
)

export const IconSearch = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m16.5 16.5 4 4" />
  </Svg>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconPencil = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="m14.5 5.5 4 4" />
  </Svg>
)

export const IconTrash = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
  </Svg>
)

export const IconLock = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.8}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
)

export const IconSliders = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </Svg>
)

export const IconChevronDown = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2.2}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconCopy = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.8}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5H6a2 2 0 0 0-2 2v9" />
  </Svg>
)

export const IconRetry = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.8}>
    <path d="M20 11a8 8 0 1 0-2.6 5.9" />
    <path d="M20 5v6h-6" />
  </Svg>
)

export const IconArrowUp = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2.1}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSun = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </Svg>
)

export const IconMoon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </Svg>
)

export const IconCheck = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 2.2}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
)

export const IconDotsVertical = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.8}>
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
  </Svg>
)

export const IconFolder = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
)

export const IconInfo = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
)

export const IconLogout = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
    <path d="M16 16l4-4-4-4M20 12H10" />
  </Svg>
)

export const IconPin = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5" />
  </Svg>
)

export const IconArchive = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
  </Svg>
)

export const IconGitBranch = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.8}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="7" r="2.4" />
    <path d="M6 8.4v7.2M18 9.4a6 6 0 0 1-6 6H8" />
  </Svg>
)

export const IconSlash = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M15 5 9 19" />
  </Svg>
)

export const IconGauge = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 18l4-5" />
  </Svg>
)

export const IconPaperclip = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M20 11l-8.5 8.5a4 4 0 0 1-5.7-5.7L14 5.6a2.6 2.6 0 0 1 3.7 3.7L9.2 17.8" />
  </Svg>
)

export const IconSideThread = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 5h16v10H9l-4 3v-3H4z" />
    <path d="M9 9h6" />
  </Svg>
)

export const IconWarning = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
)

/** Brand glyph: the </> code marks in the app icon. */
export const IconBrand = ({ size = 16 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
  </svg>
)

/** Windows title-bar controls are 12×12 with a 1px stroke, per the design. */
export const WinMinimize = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="M1 6h10" /></svg>
)
export const WinMaximize = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.2" /></svg>
)
export const WinRestore = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><rect x="1.5" y="3.5" width="7" height="7" rx="1" /><path d="M3.5 3.5V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9" /></svg>
)
export const WinClose = (): React.JSX.Element => (
  <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>
)
