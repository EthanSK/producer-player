interface PlaybackToggleIconProps {
  isPlaying: boolean;
  className?: string;
}

// Text play/pause glyphs have uneven font side-bearings, so they never sit
// quite the same inside Producer Player's circular transport buttons. This SVG
// keeps every play toggle on the same optical center across the dock,
// checklist mini-player, analysis overlay, and Ideals audition player.
export function PlaybackToggleIcon({
  isPlaying,
  className = '',
}: PlaybackToggleIconProps): JSX.Element {
  const stateClassName = isPlaying ? 'playback-toggle-icon--pause' : 'playback-toggle-icon--play';
  const iconClassName = ['playback-toggle-icon', stateClassName, className].filter(Boolean).join(' ');

  if (isPlaying) {
    return (
      <svg
        className={iconClassName}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="8.1" y="6.2" width="2.9" height="11.6" rx="0.9" />
        <rect x="13" y="6.2" width="2.9" height="11.6" rx="0.9" />
      </svg>
    );
  }

  return (
    <svg
      className={iconClassName}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.4 6.2 17.1 12 8.4 17.8Z" />
    </svg>
  );
}
