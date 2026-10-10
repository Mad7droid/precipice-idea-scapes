/**
 * The handful of 16px glyphs the home page needs. Stroke-only and `currentColor`, so each one
 * takes its colour from the control it sits in and never needs a token of its own.
 */
type IconProps = { className?: string };

function Glyph({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className ?? ""}`}
    >
      {children}
    </svg>
  );
}

export const ImportIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 2.5v7.5M5 7l3 3 3-3M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
  </Glyph>
);

export const BackupIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 4.5h11v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1ZM2 2.5h12v2H2ZM6.5 7.5h3" />
  </Glyph>
);

export const SettingsIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Glyph>
);

export const HelpIcon = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.5c0 1.2-1.8 1.5-1.8 2.6M8 11.4v.1" />
  </Glyph>
);

export const SearchIcon = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="7" cy="7" r="4.3" />
    <path d="m10.2 10.2 3.3 3.3" />
  </Glyph>
);

export const GridIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Glyph>
);

export const ListIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" />
  </Glyph>
);

export const PinIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Glyph {...p}>
    <path
      d="M9.8 2.2 13.8 6.2l-1.6.6-2.4 2.4-.4 3-1.4 1.4-2.3-2.3-2.8 2.8M3.4 7.4l1.4-1.4 3-.4 2.4-2.4Z"
      fill={filled ? "currentColor" : "none"}
    />
  </Glyph>
);

export const MoreIcon = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
    <circle cx="3.5" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="12.5" cy="8" r="1.2" />
  </svg>
);

export const SparkIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12" />
  </Glyph>
);

export const AgentIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2.5" y="4" width="11" height="8.5" rx="2" />
    <path d="M8 1.8V4M6 8h.1M10 8h.1M6.2 10.3h3.6" />
  </Glyph>
);

export const LinkIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.7-.7" />
  </Glyph>
);

export const DeviceIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2" y="3" width="12" height="8" rx="1.2" />
    <path d="M5.5 13.5h5" />
  </Glyph>
);

export const HomeIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z" />
  </Glyph>
);

export const TemplatesIcon = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Glyph>
);

export const GlobeIcon = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M2.2 8h11.6M8 2.2c1.6 1.6 2.4 3.6 2.4 5.8S9.6 12.2 8 13.8C6.4 12.2 5.6 10.2 5.6 8S6.4 3.8 8 2.2Z" />
  </Glyph>
);

export const InstructionsIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.5 2.5h9v11h-9ZM5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
  </Glyph>
);

export const PlusIcon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 3v10M3 8h10" />
  </Glyph>
);
