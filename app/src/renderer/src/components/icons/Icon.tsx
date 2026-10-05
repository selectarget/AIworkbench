import React from 'react';

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'refresh'
  | 'columns'
  | 'panel-right'
  | 'library'
  | 'more'
  | 'settings'
  | 'plus'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'external'
  | 'close'
  | 'link'
  | 'copy'
  | 'download'
  | 'globe'
  | 'keyboard'
  | 'grid'
  | 'candidate'
  | 'image'
  | 'video'
  | 'search'
  | 'play'
  | 'check'
  | 'folder'
  | 'trash'
  | 'retry'
  | 'sparkle';

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className = '' }: IconProps): React.JSX.Element {
  const paths: Record<IconName, React.JSX.Element> = {
    'arrow-left': <path d="M15 18 9 12l6-6" />,
    'arrow-right': <path d="m9 18 6-6-6-6" />,
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.7-4L4 9" />
        <path d="M4 4v5h5" />
        <path d="M4 13a8 8 0 0 0 14.7 4L20 15" />
        <path d="M20 20v-5h-5" />
      </>
    ),
    columns: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M12 4v16" />
      </>
    ),
    'panel-right': (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M15 5v14" />
      </>
    ),
    library: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M8 4v16M5 9h14" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-up': <path d="m18 15-6-6-6 6" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    external: (
      <>
        <path d="M14 5h5v5" />
        <path d="m19 5-8 8" />
        <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.4" />
        <path d="M14 11a5 5 0 0 0-7.1-.1l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    download: (
      <>
        <path d="M12 4v10" />
        <path d="m8 11 4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="8.8" />
        <path d="M3.2 12h17.6" />
        <path d="M12 3.2a14 14 0 0 1 0 17.6 14 14 0 0 1 0-17.6z" />
      </>
    ),
    keyboard: (
      <>
        <rect x="2.2" y="6" width="19.6" height="12" rx="2.4" />
        <path d="M4.9 10h3M10.5 10h3M16.1 10h3M8.5 14h7" />
      </>
    ),
    grid: (
      <>
        <rect x="3.2" y="3.2" width="7.4" height="7.4" rx="1.8" />
        <rect x="13.4" y="3.2" width="7.4" height="7.4" rx="1.8" />
        <rect x="3.2" y="13.4" width="7.4" height="7.4" rx="1.8" />
        <rect x="13.4" y="13.4" width="7.4" height="7.4" rx="1.8" />
      </>
    ),
    candidate: (
      <>
        <path d="M5 6h14M5 12h14M5 18h9" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8" cy="9" r="1.5" />
        <path d="m4 17 5-5 3 3 2-2 6 5" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4 4" />
      </>
    ),
    play: <path d="m9 6 9 6-9 6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    folder: (
      <>
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
    retry: (
      <>
        <path d="M20 11a8 8 0 0 0-14.7-4L4 9" />
        <path d="M4 4v5h5" />
        <path d="M20 13a8 8 0 0 1-14.7 4L4 15" />
        <path d="M20 20v-5h-5" />
      </>
    ),
    sparkle: (
      <>
        <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4z" />
        <path d="m19 16 .5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5z" />
      </>
    )
  };

  return (
    <svg
      className={`icon icon-${name} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
