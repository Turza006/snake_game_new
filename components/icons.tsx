import { POWERUPS, type PowerUpType } from '@/engine/config';

/* Inline SVG icons (no external files). Stroke icons use the .ic class, filled ones .ic-fill. */

export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" className="ic-fill" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
);
export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" className="ic-fill" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.5" /><rect x="13.5" y="5" width="4.5" height="14" rx="1.5" /></svg>
);
export const RestartIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" /></svg>
);
export const HomeIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></svg>
);
export const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);
export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const CrownIcon = () => (
  <svg viewBox="0 0 24 24" className="ic-fill" aria-hidden="true"><path d="M3 7.5l4.5 4 4.5-6.5 4.5 6.5 4.5-4-2 11.5H5z" /></svg>
);
export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
);
export const GearIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const SoundIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
);
export const MusicIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
);
export const VibrateIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M3 9v6M21 9v6" /></svg>
);
export const MotionIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>
);
export const ControlsIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M9 3h6v6H9zM3 9h6v6H3zM15 9h6v6h-6zM9 15h6v6H9z" /></svg>
);
export const PaletteIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-2l-.4-1a2 2 0 0 1 1.9-2.6H17a4 4 0 0 0 4-4c0-4.7-4-8.4-9-8.4z" />
    <circle cx="7.5" cy="11" r="1.2" /><circle cx="10.5" cy="7" r="1.2" /><circle cx="15" cy="7.5" r="1.2" />
  </svg>
);
export const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>
);

export const ModeIcon = ({ mode }: { mode: 'classic' | 'zen' | 'arcade' }) => {
  if (mode === 'classic') return <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M7 16h4.5V9H17" /></svg>;
  if (mode === 'zen') return <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M12 12c-1.6-2.6-3.2-4.5-5.5-4.5a4.5 4.5 0 0 0 0 9c2.3 0 3.9-1.9 5.5-4.5zm0 0c1.6 2.6 3.2 4.5 5.5 4.5a4.5 4.5 0 0 0 0-9c-2.3 0-3.9 1.9-5.5 4.5z" /></svg>;
  return <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><path d="M13 2L5 13.5h6L10 22l8-11.5h-6z" /></svg>;
};

/* Power-up icon built from the same path data the canvas uses */
export const PowerUpIcon = ({ type }: { type: PowerUpType }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {POWERUPS[type].paths.map((p, i) => {
      const col = p.tone === 'dark' ? '#0d0b22' : p.tone === 'light' ? '#ffffff' : 'currentColor';
      return p.fill
        ? <path key={i} d={p.d} fill={col} />
        : <path key={i} d={p.d} fill="none" stroke={col} strokeWidth={p.w} strokeLinecap="round" strokeLinejoin="round" />;
    })}
  </svg>
);
