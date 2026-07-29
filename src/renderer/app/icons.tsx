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
