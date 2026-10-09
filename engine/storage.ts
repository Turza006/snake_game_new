/* =========================================================================
   STORAGE — best score per mode, settings, onboarding flag (localStorage)
   ========================================================================= */
import { CONFIG, MODES, THEMES, type Controls, type Mode, type ThemeName } from './config';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  controls: Controls;
  theme: ThemeName;
  reduceMotion: boolean;
}

export interface SaveData {
  v: number;
  best: Record<Mode, number>;
  settings: Settings;
  onboarded: boolean;
  mode: Mode;
}

export function defaultData(): SaveData {
  let rm = false;
  try { rm = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  return {
    v: 1,
    best: { classic: 0, zen: 0, arcade: 0 },
    settings: { sound: true, music: false, haptics: true, controls: 'swipe', theme: 'neon', reduceMotion: rm },
    onboarded: false,
    mode: 'classic',
  };
}

export const Store = {
  data: defaultData(),

  load(): SaveData {
    const d = defaultData();
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      const p = raw ? JSON.parse(raw) : null;
      if (p && typeof p === 'object') {
        if (p.best) for (const m of MODES) if (Number.isFinite(p.best[m]) && p.best[m] >= 0) d.best[m] = Math.floor(p.best[m]);
        if (p.settings) {
          const s = d.settings as unknown as Record<string, unknown>;
          for (const k in s) if (typeof p.settings[k] === typeof s[k]) s[k] = p.settings[k];
        }
        if (!THEMES[d.settings.theme]) d.settings.theme = 'neon';
        if (d.settings.controls !== 'swipe' && d.settings.controls !== 'dpad') d.settings.controls = 'swipe';
        if (MODES.indexOf(p.mode) >= 0) d.mode = p.mode;
        d.onboarded = !!p.onboarded;
      }
    } catch { /* private mode / corrupted data: fall back to defaults */ }
    this.data = d;
    return d;
  },

  save() {
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.data)); } catch { /* quota / private mode */ }
  },
};
