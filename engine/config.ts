/* =========================================================================
   CONFIG — every gameplay / visual tunable lives here
   ========================================================================= */

export type Mode = 'classic' | 'zen' | 'arcade';
export type GameMode = Mode | 'demo';
export type PowerUpType = 'slow' | 'ghost' | 'magnet' | 'double';
export type ThemeName = 'neon' | 'nature' | 'mono';
export type Controls = 'swipe' | 'dpad';

export const CONFIG = {
  grid: {
    targetCell: 24,        // preferred cell size (CSS px) used to choose the column count
    minCols: 12, maxCols: 24,
    minRows: 12, maxRows: 40,
    maxCell: 34,           // cells never get bigger than this (desktop / tablets)
    sidePad: 12,           // horizontal gap between board and screen edge
    hudHeight: 88,         // vertical space reserved for the HUD above the board
    bottomGap: 14,         // space under the board when the D-pad is hidden
    boardPad: 8,           // glass frame drawn around the grid
  },
  speed: {                 // milliseconds per grid step (lower = faster)
    classic: { base: 140, min: 70, perLevel: 8 },
    zen:     { base: 150, min: 95, perLevel: 5 },
    arcade:  { base: 135, min: 65, perLevel: 8 },
    demo:    { base: 115, min: 115, perLevel: 0 },
    foodsPerLevel: 5,      // foods eaten per level-up
  },
  snake: { startLength: 4, demoMaxLength: 26 },
  food: { points: 10, goldenPoints: 50, goldenChance: 0.12, goldenLifeMs: 5000, goldenGrow: 2, minHeadDist: 3 },
  combo: { windowMs: 2000, maxMult: 5 },
  powerUps: {
    durationMs: 6000,      // how long an active power-up lasts
    boardLifeMs: 8000,     // how long an uncollected power-up stays on the board
    spawnChance: 0.28,     // chance to spawn after each food (Arcade)
    minFoodsBetween: 2,
    slowFactor: 1.6,       // Slow-mo multiplies the step time by this
    magnetRadius: 6,       // Manhattan distance in cells
    warnMs: 1500,          // HUD/snake flash before a power-up ends
  },
  obstacles: { start: 3, perLevel: 1, max: 12, safeAhead: 6 },
  input: { swipeThreshold: 20, bufferSize: 2 },
  render: { maxDpr: 2.5, lowDpr: 1.5, slowFrameMs: 22, bokehCount: 16, bulgeSpeed: 1.5, demoCell: 30 },
  particles: { pool: 700, fxPool: 280, eat: 18, golden: 32, perSegment: 5 },
  timing: { countdownStep: 650, resumeStep: 420, deathSlowMs: 650, deathTotalMs: 1350, deathTimeScale: 0.25, introMs: 480 },
  storageKey: 'snake.premium.v1',
};

/* ---------- Themes ---------- */
interface ThemeBase {
  name: string; dark: boolean; meta: string;
  bgTop: string; bgBottom: string; bgGlow: string; bgGlowA: number; bgGlow2: string; bgGlow2A: number; vignette: string;
  board: string; boardEdge: string; wall: string; grid: string; gridDot: string; gridLight: string; gridLightA: number;
  snakeHead: string; snakeTail: string; snakeGlow: string; highlight: string;
  eyeWhite: string; pupil: string; mouth: string; tongue: string;
  food: string; foodCore: string; leaf: string | null; golden: string; goldenCore: string;
  obstacle: string; obstacleEdge: string;
  bokeh: string[];
  particleBlend: GlobalCompositeOperation; floatText: string; combo: string; textOutline: string;
  confetti: string[];
  ui: Record<string, string>;
}
export interface Theme extends ThemeBase {
  /* derived colour strings, precomputed once so the render loop never builds strings */
  snakeGlowA: string; snakeGlowB: string; shadow: string; foodRing: string; goldenTrack: string;
}

export function hexToRgb(h: string): [number, number, number] {
  h = h.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}
function makeTheme(t: ThemeBase): Theme {
  return {
    ...t,
    snakeGlowA: rgba(t.snakeGlow, 0.045),
    snakeGlowB: rgba(t.snakeGlow, 0.1),
    shadow: t.dark ? 'rgba(0,0,0,0.3)' : 'rgba(20,70,35,0.16)',
    foodRing: rgba(t.food, 0.45),
    goldenTrack: rgba(t.golden, 0.22),
  };
}

/* Add a new object here (and a button in Settings) to add a theme. */
export const THEMES: Record<ThemeName, Theme> = {
  neon: makeTheme({
    name: 'Neon', dark: true, meta: '#0a0f2c',
    bgTop: '#0a0f2c', bgBottom: '#2b0d4f', bgGlow: '#5b4dff', bgGlowA: 0.24, bgGlow2: '#ff4f8b', bgGlow2A: 0.10, vignette: 'rgba(2,2,14,0.62)',
    board: 'rgba(255,255,255,0.035)', boardEdge: 'rgba(170,150,255,0.24)', wall: 'rgba(120,230,255,0.42)', grid: 'rgba(160,150,255,0.085)', gridDot: 'rgba(190,180,255,0.16)',
    gridLight: '#5ef2ff', gridLightA: 0.11,
    snakeHead: '#5ef2ff', snakeTail: '#b45cff', snakeGlow: '#7b8cff', highlight: 'rgba(255,255,255,0.5)',
    eyeWhite: '#ffffff', pupil: '#120a2e', mouth: '#1b0b33', tongue: '#ff4f8b',
    food: '#ff4f8b', foodCore: '#ffd6e6', leaf: null, golden: '#ffd84d', goldenCore: '#fff7d1',
    obstacle: '#2a1f63', obstacleEdge: '#8b7bff',
    bokeh: ['#5ef2ff', '#b45cff', '#ff4f8b', '#7b8cff'],
    particleBlend: 'lighter', floatText: '#ffffff', combo: '#5ef2ff', textOutline: 'rgba(10,6,30,0.55)',
    confetti: ['#5ef2ff', '#b45cff', '#ff4f8b', '#ffd84d', '#ffffff'],
    ui: { '--bg': '#0a0f2c', '--bg2': '#2b0d4f', '--text': '#f4f2ff', '--text-dim': 'rgba(236,232,255,0.64)', '--accent': '#5ef2ff', '--accent2': '#ff4f8b', '--accent3': '#b45cff',
      '--glass': 'rgba(255,255,255,0.07)', '--glass-strong': 'rgba(22,16,58,0.74)', '--glass-border': 'rgba(255,255,255,0.14)', '--card-hi': 'rgba(255,255,255,0.12)', '--card-lo': 'rgba(255,255,255,0.03)',
      '--icon-bg': 'rgba(255,255,255,0.08)', '--btn-text': '#0a0f2c', '--scrim': 'rgba(6,4,20,0.6)', '--scrim-soft': 'rgba(6,4,20,0.18)', '--glow': 'rgba(94,242,255,0.45)', '--chip-bg': 'rgba(10,8,30,0.5)' },
  }),
  nature: makeTheme({
    name: 'Nature', dark: false, meta: '#e6f4e0',
    bgTop: '#eef8e8', bgBottom: '#bfe2c4', bgGlow: '#fff6d2', bgGlowA: 0.85, bgGlow2: '#9fd6b0', bgGlow2A: 0.35, vignette: 'rgba(40,80,50,0.16)',
    board: 'rgba(255,255,255,0.5)', boardEdge: 'rgba(40,110,70,0.2)', wall: 'rgba(40,110,70,0.42)', grid: 'rgba(40,110,70,0.075)', gridDot: 'rgba(40,110,70,0.14)',
    gridLight: '#fffbe6', gridLightA: 0.55,
    snakeHead: '#5cc56f', snakeTail: '#1f7a55', snakeGlow: '#7fd38f', highlight: 'rgba(255,255,255,0.55)',
    eyeWhite: '#ffffff', pupil: '#1c2b22', mouth: '#3a1d17', tongue: '#e8475f',
    food: '#ef4b4b', foodCore: '#ffd3c9', leaf: '#3fa45b', golden: '#f2b316', goldenCore: '#fff4c8',
    obstacle: '#8a7a64', obstacleEdge: '#c4b49a',
    bokeh: ['#ffffff', '#fff2b8', '#d6f5cf'],
    particleBlend: 'source-over', floatText: '#1e4a2e', combo: '#e8742f', textOutline: 'rgba(255,255,255,0.8)',
    confetti: ['#2f9e57', '#ef6b4b', '#f2b316', '#5cc56f', '#ffffff'],
    ui: { '--bg': '#e6f4e0', '--bg2': '#bfe2c4', '--text': '#173323', '--text-dim': 'rgba(23,51,35,0.62)', '--accent': '#2f9e57', '--accent2': '#ef6b4b', '--accent3': '#1f7a55',
      '--glass': 'rgba(255,255,255,0.55)', '--glass-strong': 'rgba(250,255,248,0.82)', '--glass-border': 'rgba(30,90,50,0.15)', '--card-hi': 'rgba(255,255,255,0.8)', '--card-lo': 'rgba(255,255,255,0.45)',
      '--icon-bg': 'rgba(47,158,87,0.12)', '--btn-text': '#ffffff', '--scrim': 'rgba(30,60,40,0.28)', '--scrim-soft': 'rgba(238,248,232,0.25)', '--glow': 'rgba(47,158,87,0.35)', '--chip-bg': 'rgba(255,255,255,0.75)' },
  }),
  mono: makeTheme({
    name: 'Mono', dark: true, meta: '#0b0b0c',
    bgTop: '#0c0c0e', bgBottom: '#18181b', bgGlow: '#ffffff', bgGlowA: 0.05, bgGlow2: '#ffffff', bgGlow2A: 0.02, vignette: 'rgba(0,0,0,0.6)',
    board: 'rgba(255,255,255,0.025)', boardEdge: 'rgba(255,255,255,0.14)', wall: 'rgba(255,255,255,0.35)', grid: 'rgba(255,255,255,0.05)', gridDot: 'rgba(255,255,255,0.1)',
    gridLight: '#ffffff', gridLightA: 0.05,
    snakeHead: '#ffffff', snakeTail: '#5d5d63', snakeGlow: '#ffffff', highlight: 'rgba(255,255,255,0.35)',
    eyeWhite: '#141416', pupil: '#ffffff', mouth: '#141416', tongue: '#9a9aa0',
    food: '#ffffff', foodCore: '#d0d0d4', leaf: null, golden: '#e9e9ec', goldenCore: '#ffffff',
    obstacle: '#26262b', obstacleEdge: '#6a6a72',
    bokeh: ['#ffffff'],
    particleBlend: 'lighter', floatText: '#ffffff', combo: '#ffffff', textOutline: 'rgba(0,0,0,0.6)',
    confetti: ['#ffffff', '#bdbdc2', '#7d7d84'],
    ui: { '--bg': '#0b0b0c', '--bg2': '#18181b', '--text': '#f5f5f7', '--text-dim': 'rgba(245,245,247,0.55)', '--accent': '#ffffff', '--accent2': '#c8c8cc', '--accent3': '#8e8e93',
      '--glass': 'rgba(255,255,255,0.06)', '--glass-strong': 'rgba(24,24,27,0.82)', '--glass-border': 'rgba(255,255,255,0.13)', '--card-hi': 'rgba(255,255,255,0.09)', '--card-lo': 'rgba(255,255,255,0.02)',
      '--icon-bg': 'rgba(255,255,255,0.08)', '--btn-text': '#0b0b0c', '--scrim': 'rgba(0,0,0,0.6)', '--scrim-soft': 'rgba(0,0,0,0.2)', '--glow': 'rgba(255,255,255,0.25)', '--chip-bg': 'rgba(0,0,0,0.55)' },
  }),
};

/* ---------- Power-ups: icon paths shared by the HUD (SVG) and the canvas (Path2D) ---------- */
export interface PUPath { d: string; w?: number; fill?: boolean; tone?: 'dark' | 'light' }
export interface PUDef { label: string; color: string; paths: PUPath[] }

export const POWERUPS: Record<PowerUpType, PUDef> = {
  slow: { label: 'Slow-mo', color: '#6ec8ff', paths: [
    { d: 'M6 3h12M6 21h12', w: 2.6 },
    { d: 'M7.5 3c0 5.5 9 5.5 9 9s-9 3.5-9 9M16.5 3c0 5.5-9 5.5-9 9s9 3.5 9 9', w: 2.2 } ] },
  ghost: { label: 'Ghost', color: '#d6c9ff', paths: [
    { d: 'M5 21V11a7 7 0 0 1 14 0v10l-2.4-1.6-2.3 1.6-2.3-1.6-2.3 1.6-2.3-1.6z', fill: true },
    { d: 'M8 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM13 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z', fill: true, tone: 'dark' } ] },
  magnet: { label: 'Magnet', color: '#ff6b7a', paths: [
    { d: 'M6 3v8a6 6 0 0 0 12 0V3', w: 3.6 },
    { d: 'M6 3.2v2.6M18 3.2v2.6', w: 3.6, tone: 'light' } ] },
  double: { label: '2x Points', color: '#ffd84d', paths: [
    { d: 'M3.5 8.5l6 7M9.5 8.5l-6 7', w: 2.4 },
    { d: 'M13 10.2a2.9 2.9 0 0 1 5.8 0c0 2.4-5.8 3.6-5.8 6.3h6', w: 2.4 } ] },
};

export const PU_TYPES: PowerUpType[] = ['slow', 'ghost', 'magnet', 'double'];
export const MODES: Mode[] = ['classic', 'zen', 'arcade'];
export const MODE_NAMES: Record<Mode, string> = { classic: 'Classic', zen: 'Zen', arcade: 'Arcade' };
export const MODE_HINTS: Record<Mode, string> = { classic: 'Classic · Walls are deadly', zen: 'Zen · Edges wrap around', arcade: 'Arcade · Walls are deadly' };
export const MODE_INFO: Record<Mode, string> = {
  classic: 'Walls bite back. Pure, timeless snake.',
  zen: 'Edges wrap around. Breathe and glide.',
  arcade: 'Power-ups, obstacles and big combos.',
};

/* Directions: 0 up, 1 right, 2 down, 3 left */
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
export const TAU = Math.PI * 2;
