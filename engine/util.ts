import { POWERUPS, type PowerUpType, hexToRgb } from './config';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const easeOutCubic = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeOutBack = (t: number) => { const u = t - 1; return 1 + 2.70158 * u * u * u + 1.70158 * u * u; };

/* 64-step head→tail colour lookup so the render loop never builds colour strings */
export function buildLUT(a: string, b: string, n: number): string[] {
  const A = hexToRgb(a), B = hexToRgb(b), out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push('rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')');
  }
  return out;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function makeStarPath(): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.47 : 1, a = -Math.PI / 2 + i * Math.PI / 5;
    if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r); else p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  p.closePath();
  return p;
}

const pathCache: Partial<Record<PowerUpType, Path2D[]>> = {};
function puPaths(type: PowerUpType): Path2D[] {
  return pathCache[type] || (pathCache[type] = POWERUPS[type].paths.map(p => new Path2D(p.d)));
}

/* Draw a power-up icon on canvas. ink = main colour, base = badge colour (used for "holes") */
export function drawPUIcon(ctx: CanvasRenderingContext2D, type: PowerUpType, cx: number, cy: number, size: number, ink: string, base: string) {
  const def = POWERUPS[type], paths = puPaths(type), k = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(k, k);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < def.paths.length; i++) {
    const p = def.paths[i];
    const col = p.tone === 'dark' ? base : p.tone === 'light' ? '#ffffff' : ink;
    if (p.fill) { ctx.fillStyle = col; ctx.fill(paths[i]); }
    else { ctx.strokeStyle = col; ctx.lineWidth = p.w || 2; ctx.stroke(paths[i]); }
  }
  ctx.restore();
}

export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* Canvas font strings, cached per pixel size. The family comes from next/font at runtime. */
let fontFamily = 'system-ui, -apple-system, sans-serif';
const fontCache: Record<number, string> = {};
export function setCanvasFontFamily(family: string) {
  if (!family) return;
  fontFamily = family + ', system-ui, -apple-system, sans-serif';
  for (const k in fontCache) delete fontCache[k];
}
export function fontFor(px: number): string {
  const k = Math.round(px);
  return fontCache[k] || (fontCache[k] = '800 ' + k + 'px ' + fontFamily);
}
