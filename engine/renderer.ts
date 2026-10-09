/* =========================================================================
   RENDERER — Canvas 2D. Static layers are pre-rendered offscreen; the
   per-frame path reuses typed arrays and cached strings (no allocations).
   ========================================================================= */
import { CONFIG, DIR_ANGLE, POWERUPS, PU_TYPES, TAU, rgba, type PowerUpType, type Theme } from './config';
import type { Game } from './game';
import { Floats, Particles } from './particles';
import { buildLUT, clamp, drawPUIcon, easeOutBack, easeOutCubic, makeStarPath, roundRect } from './util';

interface Bokeh { x: number; y: number; r: number; vx: number; vy: number; a: number; ph: number; color: string }
export interface Area { x: number; y: number; w: number; h: number }

export class Renderer {
  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly fxCv: HTMLCanvasElement;
  readonly fx: CanvasRenderingContext2D;
  private probe: HTMLElement;
  private dpadEl: HTMLElement;

  dpr = 1;
  maxDpr = CONFIG.render.maxDpr;
  vw = 1; vh = 1;
  safe = { t: 0, r: 0, b: 0, l: 0 };
  reduced = false;
  theme!: Theme;
  lut: string[] = [];
  shake = 0; zoom = 0; flash = 0;

  private glowCache: Record<string, HTMLCanvasElement> = {};
  private bgLayer: HTMLCanvasElement;
  private boardLayer: HTMLCanvasElement;
  private obstacleSprite: HTMLCanvasElement;
  private puSprites = {} as Record<PowerUpType, HTMLCanvasElement>;
  private spriteCell = 0; private spriteDpr = 0;
  private starPath: Path2D;
  private bokeh: Bokeh[] = [];
  private sx = new Float32Array(64); private sy = new Float32Array(64);
  private P = { x: new Float32Array(160), y: new Float32Array(160), i: new Float32Array(160), brk: new Uint8Array(160), n: 0, split: false };
  private bulge = new Float32Array(8); private bulgeN = 0;
  private DASH = [4, 6]; private NO_DASH: number[] = []; private WALL_DASH = [6, 7];

  constructor(canvas: HTMLCanvasElement, fx: HTMLCanvasElement, probe: HTMLElement, dpad: HTMLElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.fxCv = fx;
    this.fx = fx.getContext('2d')!;
    this.probe = probe;
    this.dpadEl = dpad;
    this.bgLayer = document.createElement('canvas');
    this.boardLayer = document.createElement('canvas');
    this.obstacleSprite = document.createElement('canvas');
    for (const t of PU_TYPES) this.puSprites[t] = document.createElement('canvas');
    this.starPath = makeStarPath();
  }

  /* Size canvases to the viewport × devicePixelRatio and rebuild static layers */
  fit() {
    this.vw = Math.max(1, window.innerWidth);
    this.vh = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const W = Math.round(this.vw * this.dpr), H = Math.round(this.vh * this.dpr);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W; this.cv.height = H;
      this.fxCv.width = W; this.fxCv.height = H;
    }
    const cs = getComputedStyle(this.probe);
    this.safe.t = parseFloat(cs.paddingTop) || 0;
    this.safe.r = parseFloat(cs.paddingRight) || 0;
    this.safe.b = parseFloat(cs.paddingBottom) || 0;
    this.safe.l = parseFloat(cs.paddingLeft) || 0;
    this.buildBackground();
    this.initBokeh();
  }

  setTheme(th: Theme) {
    this.theme = th;
    this.lut = buildLUT(th.snakeHead, th.snakeTail, 64);
    this.glowCache = {};
    this.spriteCell = 0;
    if (this.vw > 1) { this.buildBackground(); this.initBokeh(); }
  }

  /* ---- Layout ---- */
  playArea(dpadOn: boolean): Area {
    const s = this.safe, G = CONFIG.grid;
    const top = s.t + G.hudHeight;
    let bottom = this.vh - s.b - G.bottomGap;
    if (dpadOn) {
      const r = this.dpadEl.getBoundingClientRect();
      if (r.height) bottom = Math.min(bottom, r.top - 12);
    }
    const left = s.l + G.sidePad, right = this.vw - s.r - G.sidePad;
    return { x: left, y: top, w: Math.max(60, right - left), h: Math.max(60, bottom - top) };
  }

  gridFor(a: Area) {
    const G = CONFIG.grid;
    const cols = clamp(Math.floor(a.w / G.targetCell), G.minCols, G.maxCols);
    const cell = Math.min(G.maxCell, Math.floor(a.w / cols));
    const rows = clamp(Math.floor(a.h / cell), G.minRows, G.maxRows);
    return { cols, rows };
  }

  /* The grid size is fixed per run; on resize only the cell size is re-fitted */
  layoutGame(g: Game, dpadOn: boolean) {
    const a = this.playArea(dpadOn), L = g.L;
    L.cell = Math.max(6, Math.floor(Math.min(a.w / g.cols, a.h / g.rows, CONFIG.grid.maxCell)));
    L.w = g.cols * L.cell; L.h = g.rows * L.cell;
    L.x = Math.round(a.x + (a.w - L.w) / 2);
    L.y = Math.round(a.y + (a.h - L.h) / 2);
    this.DASH[0] = L.cell * 0.22; this.DASH[1] = L.cell * 0.3;
    this.buildBoard(g);
    this.buildSprites(L.cell);
  }

  layoutDemo(g: Game, cell: number) {
    const L = g.L;
    L.cell = cell; L.w = g.cols * cell; L.h = g.rows * cell;
    L.x = Math.round((this.vw - L.w) / 2); L.y = Math.round((this.vh - L.h) / 2);
  }

  /* ---- Pre-rendered layers ---- */
  private buildBackground() {
    const th = this.theme, w = this.vw, h = this.vh, d = this.dpr, c = this.bgLayer;
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    const g = c.getContext('2d')!;
    g.setTransform(d, 0, 0, d, 0, 0);
    let grd = g.createLinearGradient(0, 0, w * 0.35, h);
    grd.addColorStop(0, th.bgTop); grd.addColorStop(1, th.bgBottom);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const R = Math.max(w, h);
    grd = g.createRadialGradient(w * 0.5, h * 0.06, 0, w * 0.5, h * 0.06, R * 0.75);
    grd.addColorStop(0, rgba(th.bgGlow, th.bgGlowA)); grd.addColorStop(1, rgba(th.bgGlow, 0));
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    grd = g.createRadialGradient(w * 0.95, h * 0.95, 0, w * 0.95, h * 0.95, R * 0.6);
    grd.addColorStop(0, rgba(th.bgGlow2, th.bgGlow2A)); grd.addColorStop(1, rgba(th.bgGlow2, 0));
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, R * 0.78);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, th.vignette);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }

  private buildBoard(g: Game) {
    const L = g.L, th = this.theme, d = this.dpr, pad = CONFIG.grid.boardPad, c = this.boardLayer;
    const W = L.w + pad * 2, H = L.h + pad * 2;
    c.width = Math.round(W * d); c.height = Math.round(H * d);
    const x = c.getContext('2d')!;
    x.setTransform(d, 0, 0, d, 0, 0);
    x.clearRect(0, 0, W, H);
    roundRect(x, 0.5, 0.5, W - 1, H - 1, 16);
    x.fillStyle = th.board; x.fill();
    x.strokeStyle = th.boardEdge; x.lineWidth = 1; x.stroke();
    x.beginPath();
    for (let i = 1; i < g.cols; i++) { const gx = pad + i * L.cell; x.moveTo(gx, pad); x.lineTo(gx, pad + L.h); }
    for (let j = 1; j < g.rows; j++) { const gy = pad + j * L.cell; x.moveTo(pad, gy); x.lineTo(pad + L.w, gy); }
    x.strokeStyle = th.grid; x.lineWidth = 1; x.stroke();
    x.fillStyle = th.gridDot;
    for (let i = 1; i < g.cols; i++) for (let j = 1; j < g.rows; j++) x.fillRect(pad + i * L.cell - 1, pad + j * L.cell - 1, 2, 2);
    // Solid border = deadly walls. Wrapping edges are drawn live (animated dashes) in render().
    if (!g.wrapsBoard) {
      roundRect(x, pad, pad, L.w, L.h, 6);
      x.strokeStyle = th.wall; x.lineWidth = 1.5;
      x.stroke();
    }
  }

  private buildSprites(cell: number) {
    if (this.spriteCell === cell && this.spriteDpr === this.dpr) return;
    this.spriteCell = cell; this.spriteDpr = this.dpr;
    const d = this.dpr, th = this.theme, S = Math.ceil(cell * d);
    // Obstacle: faceted crystal block
    const o = this.obstacleSprite;
    o.width = o.height = S;
    let x = o.getContext('2d')!;
    x.setTransform(d, 0, 0, d, 0, 0);
    const m = cell * 0.08, w = cell - m * 2;
    const grd = x.createLinearGradient(0, 0, cell, cell);
    grd.addColorStop(0, th.obstacleEdge); grd.addColorStop(1, th.obstacle);
    roundRect(x, m, m, w, w, cell * 0.24);
    x.fillStyle = grd; x.fill();
    x.lineWidth = Math.max(1, cell * 0.05); x.strokeStyle = rgba(th.obstacleEdge, 0.9); x.stroke();
    x.beginPath();
    x.moveTo(m + w * 0.24, m + w * 0.34); x.lineTo(m + w * 0.5, m + w * 0.2); x.lineTo(m + w * 0.76, m + w * 0.34);
    x.strokeStyle = 'rgba(255,255,255,0.38)'; x.lineCap = 'round'; x.stroke();
    // Power-up badges
    for (const t of PU_TYPES) {
      const col = POWERUPS[t].color, c = this.puSprites[t];
      c.width = c.height = S;
      x = c.getContext('2d')!;
      x.setTransform(d, 0, 0, d, 0, 0);
      x.beginPath(); x.arc(cell / 2, cell / 2, cell * 0.44, 0, TAU);
      x.fillStyle = col; x.fill();
      x.lineWidth = Math.max(1, cell * 0.05); x.strokeStyle = 'rgba(255,255,255,0.75)'; x.stroke();
      drawPUIcon(x, t, cell / 2, cell / 2, cell * 0.56, '#16122e', col);
    }
  }

  /* Soft radial glow sprite, cached per colour (hex) */
  private glow(color: string): HTMLCanvasElement {
    let s = this.glowCache[color];
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 128;
    const g = s.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, rgba(color, 1)); grd.addColorStop(0.22, rgba(color, 0.55));
    grd.addColorStop(0.5, rgba(color, 0.16)); grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    this.glowCache[color] = s;
    return s;
  }

  private initBokeh() {
    const th = this.theme, n = CONFIG.render.bokehCount;
    this.bokeh.length = 0;
    for (let i = 0; i < n; i++) {
      this.bokeh.push({ x: Math.random() * this.vw, y: Math.random() * this.vh, r: 30 + Math.random() * 90,
        vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 10, a: 0.05 + Math.random() * 0.12,
        ph: Math.random() * TAU, color: th.bokeh[i % th.bokeh.length] });
    }
  }

  private drawBokeh(ctx: CanvasRenderingContext2D, dt: number, now: number) {
    const s = (dt / 1000) * (this.reduced ? 0.3 : 1);
    ctx.globalCompositeOperation = this.theme.dark ? 'lighter' : 'source-over';
    for (let i = 0; i < this.bokeh.length; i++) {
      const b = this.bokeh[i];
      b.x += b.vx * s; b.y += b.vy * s;
      if (b.y < -b.r) { b.y = this.vh + b.r; b.x = Math.random() * this.vw; }
      if (b.x < -b.r) b.x = this.vw + b.r; else if (b.x > this.vw + b.r) b.x = -b.r;
      ctx.globalAlpha = b.a * (0.7 + 0.3 * Math.sin(now * 0.0006 + b.ph));
      ctx.drawImage(this.glow(b.color), b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- Frame ---- */
  render(g: Game, alpha: number, dt: number, cut: number, intro: number) {
    const ctx = this.ctx, th = this.theme, L = g.L, d = this.dpr, now = performance.now();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.bgLayer, 0, 0, this.vw, this.vh);
    this.drawBokeh(ctx, dt, now);

    // Camera: screen shake + combo zoom pulse + intro zoom, around the board centre
    let ox = 0, oy = 0, z = 1;
    if (this.shake > 0.2 && !this.reduced) {
      ox = (Math.random() * 2 - 1) * this.shake; oy = (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.exp(-dt * 0.008);
    } else this.shake = 0;
    if (this.zoom > 0.0005 && !this.reduced) { z += this.zoom; this.zoom *= Math.exp(-dt * 0.007); } else this.zoom = 0;
    if (intro < 1 && !this.reduced) z *= 0.94 + 0.06 * easeOutCubic(intro);
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    ctx.setTransform(d * z, 0, 0, d * z, d * (cx - cx * z + ox), d * (cy - cy * z + oy));

    if (!g.demo) {
      const pad = CONFIG.grid.boardPad;
      ctx.globalAlpha = 0.86 + 0.14 * Math.sin(now * 0.0012);     // gently breathing grid
      ctx.drawImage(this.boardLayer, L.x - pad, L.y - pad, L.w + pad * 2, L.h + pad * 2);
      ctx.globalAlpha = 1;
      if (g.wraps) {                      // marching dashes = these edges can be passed through
        const ghostOnly = !g.wrapsBoard;
        this.WALL_DASH[0] = ghostOnly ? 10 : 6; this.WALL_DASH[1] = ghostOnly ? 8 : 7;
        ctx.setLineDash(this.WALL_DASH);
        ctx.lineDashOffset = -now * 0.012;
        ctx.lineWidth = ghostOnly ? 2.5 : 1.5;
        ctx.strokeStyle = ghostOnly ? POWERUPS.ghost.color : th.wall;
        roundRect(ctx, L.x, L.y, L.w, L.h, 6);
        ctx.stroke();
        ctx.setLineDash(this.NO_DASH);
      }
    }
    const visible = cut < g.body.length;
    if (visible) this.computeSnake(g, alpha, cut);
    if (visible && cut === 0 && !g.demo) {                          // light pool under the head
      const G = L.cell * 7;
      ctx.globalCompositeOperation = th.dark ? 'lighter' : 'source-over';
      ctx.globalAlpha = th.gridLightA;
      ctx.drawImage(this.glow(th.gridLight), this.P.x[0] - G / 2, this.P.y[0] - G / 2, G, G);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawObstacles(g, dt);
    this.drawFoods(g, alpha, dt, now);
    this.drawItems(g, dt, now);
    if (visible) this.drawSnake(g, alpha, dt, now, cut);
    Particles.draw(ctx, th.particleBlend);
    Floats.draw(ctx, th.textOutline);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (intro < 1) {                                                 // fade the board in from the background
      ctx.globalAlpha = 1 - easeOutCubic(intro);
      ctx.drawImage(this.bgLayer, 0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0.02) {
      ctx.globalAlpha = this.flash * 0.16;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 1;
      this.flash *= Math.exp(-dt * 0.012);
    } else this.flash = 0;
  }

  private ensure(n: number) {
    if (this.sx.length < n + 4) { const m = (n + 4) * 2; this.sx = new Float32Array(m); this.sy = new Float32Array(m); }
    const P = this.P;
    if (P.x.length < n * 2 + 16) {
      const m = n * 2 + 64;
      P.x = new Float32Array(m); P.y = new Float32Array(m); P.i = new Float32Array(m); P.brk = new Uint8Array(m);
    }
  }

  /* Interpolate every segment between its previous and current cell, then build the
     draw list in pixels. Where the snake wraps an edge, the path is split and each
     half is extended one cell off-board (clipped) so it slides across seamlessly. */
  private computeSnake(g: Game, alpha: number, cut: number) {
    const b = g.body, n = b.length, cols = g.cols, rows = g.rows, L = g.L, c = L.cell;
    this.ensure(n);
    const SX = this.sx, SY = this.sy, P = this.P;
    for (let i = cut; i < n; i++) {
      let px = g.prevX[i], py = g.prevY[i];
      const qx = b[i].x, qy = b[i].y, dx = qx - px, dy = qy - py;
      if (dx > 1) px += cols; else if (dx < -1) px -= cols;
      if (dy > 1) py += rows; else if (dy < -1) py -= rows;
      SX[i] = px + (qx - px) * alpha;
      SY[i] = py + (qy - py) * alpha;
    }
    const ox = L.x + c / 2, oy = L.y + c / 2;
    let m = 0, split = false;
    for (let i = cut; i < n; i++) {
      const x = SX[i], y = SY[i];
      if (i > cut) {
        const ddx = x - SX[i - 1], ddy = y - SY[i - 1];
        if (ddx > 1.5 || ddx < -1.5 || ddy > 1.5 || ddy < -1.5) {
          split = true;
          const wx = ddx > 1.5 ? -cols : ddx < -1.5 ? cols : 0, wy = ddy > 1.5 ? -rows : ddy < -1.5 ? rows : 0;
          P.x[m] = ox + (x + wx) * c; P.y[m] = oy + (y + wy) * c; P.i[m] = i; P.brk[m] = 0; m++;
          P.x[m] = ox + (SX[i - 1] - wx) * c; P.y[m] = oy + (SY[i - 1] - wy) * c; P.i[m] = i - 1; P.brk[m] = 1; m++;
        }
      }
      P.x[m] = ox + x * c; P.y[m] = oy + y * c; P.i[m] = i; P.brk[m] = i === cut ? 1 : 0; m++;
    }
    P.n = m; P.split = split;
  }

  /* Body width: full for the front half, tapering to ~1/3 at the tail, plus food bulges */
  private widthAt(i: number, n: number, W: number) {
    const t = n > 1 ? i / (n - 1) : 0;
    let w = t < 0.45 ? W : W * (1 - ((t - 0.45) / 0.55) * 0.66);
    for (let k = 0; k < this.bulgeN; k++) {
      const dd = i - this.bulge[k];
      if (dd > -2.5 && dd < 2.5) w += W * 0.42 * Math.exp(-dd * dd * 0.9);
    }
    return w;
  }

  /* Smooth path through segment centres (midpoint quadratic curves). maxI limits length. */
  private tracePath(ctx: CanvasRenderingContext2D, maxI: number) {
    const P = this.P;
    let s = 0;
    while (s < P.n) {
      let e = s;
      while (e + 1 < P.n && !P.brk[e + 1]) e++;
      if (maxI > 0 && P.i[s] > maxI) { s = e + 1; continue; }
      let ee = e;
      if (maxI > 0) while (ee > s && P.i[ee] > maxI) ee--;
      ctx.moveTo(P.x[s], P.y[s]);
      if (ee === s) ctx.lineTo(P.x[s] + 0.01, P.y[s]);
      else {
        ctx.lineTo((P.x[s] + P.x[s + 1]) * 0.5, (P.y[s] + P.y[s + 1]) * 0.5);
        for (let k = s + 1; k < ee; k++) ctx.quadraticCurveTo(P.x[k], P.y[k], (P.x[k] + P.x[k + 1]) * 0.5, (P.y[k] + P.y[k + 1]) * 0.5);
        ctx.lineTo(P.x[ee], P.y[ee]);
      }
      s = e + 1;
    }
  }

  /* Stroke the tube piece by piece (tail first) so each piece gets its own width and colour.
     Round caps make the joins seamless; pieces nearer the head paint on top. */
  private strokePieces(ctx: CanvasRenderingContext2D, n: number, W: number, fixedColor: string | null) {
    const P = this.P, lut = this.lut, last = lut.length - 1, inv = 1 / Math.max(1, n - 1);
    // Short snakes get finer sub-pieces so the head→tail gradient never shows colour bands
    const sub = fixedColor ? 1 : n < 10 ? 4 : n < 24 ? 3 : n < 60 ? 2 : 1;
    let e = P.n - 1;
    while (e >= 0) {
      let s = e;
      while (s > 0 && !P.brk[s]) s--;
      if (s === e) {
        ctx.beginPath(); ctx.moveTo(P.x[s], P.y[s]); ctx.lineTo(P.x[s] + 0.01, P.y[s]);
        ctx.lineWidth = this.widthAt(P.i[s], n, W);
        ctx.strokeStyle = fixedColor || lut[Math.min(last, Math.round(P.i[s] * inv * last))];
        ctx.stroke();
        e = s - 1;
        continue;
      }
      for (let k = e; k >= s; k--) {
        // Piece k is a quadratic A → C → B between segment midpoints (end pieces are straight)
        let ax: number, ay: number, cx: number, cy: number, bx: number, by: number, i0: number, i1: number;
        if (k === s) {
          ax = P.x[s]; ay = P.y[s]; bx = (P.x[s] + P.x[s + 1]) * 0.5; by = (P.y[s] + P.y[s + 1]) * 0.5;
          cx = (ax + bx) * 0.5; cy = (ay + by) * 0.5; i0 = P.i[s]; i1 = (P.i[s] + P.i[s + 1]) * 0.5;
        } else if (k === e) {
          ax = (P.x[e - 1] + P.x[e]) * 0.5; ay = (P.y[e - 1] + P.y[e]) * 0.5; bx = P.x[e]; by = P.y[e];
          cx = (ax + bx) * 0.5; cy = (ay + by) * 0.5; i0 = (P.i[e - 1] + P.i[e]) * 0.5; i1 = P.i[e];
        } else {
          ax = (P.x[k - 1] + P.x[k]) * 0.5; ay = (P.y[k - 1] + P.y[k]) * 0.5; cx = P.x[k]; cy = P.y[k];
          bx = (P.x[k] + P.x[k + 1]) * 0.5; by = (P.y[k] + P.y[k + 1]) * 0.5;
          i0 = (P.i[k - 1] + P.i[k]) * 0.5; i1 = (P.i[k] + P.i[k + 1]) * 0.5;
        }
        for (let j = sub - 1; j >= 0; j--) {
          // Sub-curve [u, v] of the quadratic via its blossom f(u, v)
          const u = j / sub, v = (j + 1) / sub;
          const a0 = (1 - u) * (1 - u), a1 = 2 * (1 - u) * u, a2 = u * u;
          const c0 = (1 - u) * (1 - v), c1 = (1 - u) * v + u * (1 - v), c2 = u * v;
          const b0 = (1 - v) * (1 - v), b1 = 2 * (1 - v) * v, b2 = v * v;
          ctx.beginPath();
          ctx.moveTo(a0 * ax + a1 * cx + a2 * bx, a0 * ay + a1 * cy + a2 * by);
          ctx.quadraticCurveTo(c0 * ax + c1 * cx + c2 * bx, c0 * ay + c1 * cy + c2 * by, b0 * ax + b1 * cx + b2 * bx, b0 * ay + b1 * cy + b2 * by);
          const bi = i0 + (i1 - i0) * (j + 0.5) / sub;
          ctx.lineWidth = this.widthAt(bi, n, W);
          ctx.strokeStyle = fixedColor || lut[Math.min(last, Math.round(bi * inv * last))];
          ctx.stroke();
        }
      }
      e = s - 1;
    }
  }

  private drawSnake(g: Game, alpha: number, dt: number, now: number, cut: number) {
    const ctx = this.ctx, th = this.theme, L = g.L, c = L.cell, P = this.P, n = g.body.length;
    const W = c * 0.8;
    let bn = 0;
    for (let k = 0; k < g.bulges.length && bn < 8; k++) this.bulge[bn++] = (g.ticks - g.bulges[k] + alpha) * CONFIG.render.bulgeSpeed;
    this.bulgeN = bn;
    const ghost = g.active.ghost > 0;
    const warn = ghost && g.active.ghost < CONFIG.powerUps.warnMs;
    const ghostLook = ghost && !(warn && Math.floor(now / 110) % 2 === 0);

    if (P.split) { ctx.save(); ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip(); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // 1) Outer glow (dark themes) or soft drop shadow (light themes)
    if (th.dark) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); this.tracePath(ctx, 0);
      // three additive passes give a soft falloff without shadowBlur
      ctx.strokeStyle = th.snakeGlowA; ctx.lineWidth = W * 2.6; ctx.stroke();
      ctx.lineWidth = W * 1.9; ctx.stroke();
      ctx.strokeStyle = th.snakeGlowB; ctx.lineWidth = W * 1.35; ctx.stroke();
      if (cut === 0) {
        const G = c * 2.8;
        ctx.globalAlpha = 0.4;
        ctx.drawImage(this.glow(th.snakeHead), P.x[0] - G / 2, P.y[0] - G / 2, G, G);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (!ghostLook) {
      ctx.save(); ctx.translate(c * 0.05, c * 0.13);
      this.strokePieces(ctx, n, W, th.shadow);
      ctx.restore();
    }

    // 2) Body tube + 3) inner highlight
    if (ghostLook) {
      ctx.beginPath(); this.tracePath(ctx, 0);
      ctx.globalAlpha = 0.42; ctx.strokeStyle = th.snakeHead; ctx.lineWidth = W; ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, c * 0.08);
      ctx.setLineDash(this.DASH); ctx.lineDashOffset = -now * 0.03; ctx.stroke();
      ctx.setLineDash(this.NO_DASH); ctx.globalAlpha = 1;
    } else {
      this.strokePieces(ctx, n, W, null);
      ctx.save();
      ctx.translate(-W * 0.1, -W * 0.13);
      ctx.beginPath(); this.tracePath(ctx, Math.max(1, Math.floor((n - 1) * 0.72)));
      ctx.strokeStyle = th.highlight; ctx.lineWidth = W * 0.22; ctx.stroke();
      ctx.restore();
    }

    // 4) Head
    if (cut === 0) {
      const a0 = DIR_ANGLE[g.prevDir], a1 = DIR_ANGLE[g.dir];
      let da = a1 - a0;
      if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
      const ang = a0 + da * easeOutCubic(clamp(alpha * 1.6, 0, 1));
      this.updateFace(g, P.x[0], P.y[0], ang, dt);
      this.drawHead(g, P.x[0], P.y[0], ang, c, ghostLook);
    }
    if (P.split) ctx.restore();
  }

  /* Eyes track food, blink, widen when food is close; mouth opens before eating; tongue flicks */
  private updateFace(g: Game, hx: number, hy: number, ang: number, dt: number) {
    const f = g.face, L = g.L, c = L.cell;
    f.nextBlink -= dt;
    if (f.nextBlink <= 0) { f.blinkT = 1; f.nextBlink = 1800 + Math.random() * 3400; }
    if (f.blinkT > 0) f.blinkT = Math.max(0, f.blinkT - dt / 170);
    f.blink = Math.sin(f.blinkT * Math.PI);
    f.nextTongue -= dt;
    if (f.nextTongue <= 0) { if (f.mouth < 0.1) f.tongue = 0.001; f.nextTongue = 2600 + Math.random() * 4200; }
    if (f.tongue > 0) { f.tongue += dt / 360; if (f.tongue >= 1) f.tongue = 0; }
    let best = 1e12, tx = Math.cos(ang), ty = Math.sin(ang);
    for (let k = 0; k < g.foods.length; k++) {
      const fd = g.foods[k];
      const dx = L.x + (fd.x + 0.5) * c - hx, dy = L.y + (fd.y + 0.5) * c - hy, d2 = dx * dx + dy * dy;
      if (d2 < best) { best = d2; tx = dx; ty = dy; }
    }
    const len = Math.sqrt(tx * tx + ty * ty) || 1, cs = Math.cos(-ang), sn = Math.sin(-ang);
    const lx = (tx * cs - ty * sn) / len, ly = (tx * sn + ty * cs) / len;
    const k = Math.min(1, dt * 0.012);
    f.lx += (lx - f.lx) * k; f.ly += (ly - f.ly) * k;
    f.widen += ((Math.sqrt(best) / c < 4.5 ? 1 : 0) - f.widen) * Math.min(1, dt * 0.01);
    f.mouth += ((g.alive && g.foodAhead() ? 1 : 0) - f.mouth) * Math.min(1, dt * 0.022);
    f.turn *= Math.exp(-dt * 0.011);
  }

  private drawHead(g: Game, hx: number, hy: number, ang: number, c: number, ghostLook: boolean) {
    const ctx = this.ctx, th = this.theme, f = g.face, R = c * 0.5;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    const sq = this.reduced ? 0 : f.turn;
    ctx.scale(1 + 0.2 * sq, 1 - 0.14 * sq);                    // squash & stretch on turns
    if (ghostLook) ctx.globalAlpha = 0.6;
    if (f.tongue > 0 && g.alive) {
      const ext = Math.sin(f.tongue * Math.PI), Lt = c * 0.42 * ext, x0 = R * 0.85, fork = c * 0.12 * ext;
      ctx.strokeStyle = th.tongue; ctx.lineWidth = Math.max(1, c * 0.07); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, 0); ctx.lineTo(x0 + Lt, 0); ctx.lineTo(x0 + Lt + fork, -fork * 0.7);
      ctx.moveTo(x0 + Lt, 0); ctx.lineTo(x0 + Lt + fork, fork * 0.7);
      ctx.stroke();
    }
    ctx.fillStyle = this.lut[0];
    ctx.beginPath(); ctx.ellipse(c * 0.05, 0, R * 1.06, R * 0.95, 0, 0, TAU); ctx.fill();
    // Highlight lit from the top-left of the screen regardless of heading
    const cs = Math.cos(-ang), sn = Math.sin(-ang), hlx = -c * 0.12, hly = -c * 0.16;
    ctx.fillStyle = th.highlight;
    ctx.beginPath(); ctx.arc(c * 0.05 + hlx * cs - hly * sn, hlx * sn + hly * cs, R * 0.3, 0, TAU); ctx.fill();
    if (f.mouth > 0.03) {
      const m = f.mouth * 0.62;
      ctx.fillStyle = th.mouth;
      ctx.beginPath(); ctx.moveTo(c * 0.12, 0); ctx.arc(c * 0.12, 0, R * 0.92, -m, m); ctx.closePath(); ctx.fill();
    }
    const er = c * 0.13 * (1 + 0.3 * f.widen), ex = c * 0.1, ey = c * 0.22, open = Math.max(0.1, 1 - f.blink);
    for (let s = -1; s <= 1; s += 2) {
      const yy = s * ey;
      ctx.fillStyle = th.eyeWhite;
      ctx.beginPath(); ctx.ellipse(ex, yy, er, er * open, 0, 0, TAU); ctx.fill();
      if (!g.alive) {
        const q = er * 0.55;
        ctx.strokeStyle = th.pupil; ctx.lineWidth = Math.max(1.2, c * 0.05); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex - q, yy - q); ctx.lineTo(ex + q, yy + q); ctx.moveTo(ex + q, yy - q); ctx.lineTo(ex - q, yy + q); ctx.stroke();
      } else if (open > 0.35) {
        const px = ex + f.lx * er * 0.42, py = yy + f.ly * er * 0.42 * open;
        ctx.fillStyle = th.pupil;
        ctx.beginPath(); ctx.arc(px, py, er * 0.55, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(px - er * 0.18, py - er * 0.2, er * 0.17, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawFoods(g: Game, alpha: number, dt: number, now: number) {
    const ctx = this.ctx, th = this.theme, L = g.L, c = L.cell;
    for (let k = 0; k < g.foods.length; k++) {
      const f = g.foods[k];
      f.age += dt;
      const fx = L.x + (f.px + (f.x - f.px) * alpha + 0.5) * c;
      const fy = L.y + (f.py + (f.y - f.py) * alpha + 0.5) * c + Math.sin(now * 0.0032 + f.seed) * c * 0.06;
      const s = Math.max(0.001, easeOutBack(Math.min(1, f.age / 420)));
      const col = f.golden ? th.golden : th.food;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.005 + f.seed);
      ctx.globalCompositeOperation = th.dark ? 'lighter' : 'source-over';
      ctx.globalAlpha = (th.dark ? 0.55 : 0.32) * (0.75 + 0.25 * pulse) * Math.min(1, s);
      const G = c * (f.golden ? 3.4 : 2.6) * (0.92 + 0.08 * pulse);
      ctx.drawImage(this.glow(col), fx - G / 2, fy - G / 2, G, G);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (f.golden) {
        const frac = Math.max(0, f.life / CONFIG.food.goldenLifeMs);
        const blink = frac < 0.3 && Math.floor(now / 120) % 2 === 0;
        const rr = c * 0.56 * s;
        ctx.lineWidth = Math.max(2, c * 0.08); ctx.lineCap = 'round';
        ctx.strokeStyle = th.goldenTrack;
        ctx.beginPath(); ctx.arc(fx, fy, rr, 0, TAU); ctx.stroke();
        if (!blink) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(fx, fy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke(); }
        ctx.save();
        ctx.translate(fx, fy); ctx.rotate(now * 0.0016 + f.seed);
        const r = c * 0.36 * s; ctx.scale(r, r);
        ctx.fillStyle = col; ctx.fill(this.starPath);
        ctx.restore();
        ctx.fillStyle = th.goldenCore;
        ctx.beginPath(); ctx.arc(fx - c * 0.05, fy - c * 0.06, c * 0.08 * s, 0, TAU); ctx.fill();
      } else {
        const r = c * 0.29 * s * (0.96 + 0.04 * pulse);
        ctx.strokeStyle = th.foodRing; ctx.lineWidth = Math.max(1, c * 0.045);
        ctx.beginPath(); ctx.ellipse(fx, fy, r * 1.65, r * 0.55, now * 0.0012 + f.seed, 0, TAU); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(fx, fy, r, 0, TAU); ctx.fill();
        ctx.fillStyle = th.foodCore;
        ctx.beginPath(); ctx.arc(fx - r * 0.32, fy - r * 0.34, r * 0.36, 0, TAU); ctx.fill();
        if (th.leaf) {
          ctx.save();
          ctx.translate(fx + r * 0.2, fy - r * 0.95); ctx.rotate(-0.6 + 0.15 * Math.sin(now * 0.004 + f.seed));
          ctx.fillStyle = th.leaf;
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.5, r * 0.22, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  private drawItems(g: Game, dt: number, now: number) {
    const ctx = this.ctx, L = g.L, c = L.cell, th = this.theme;
    for (let k = 0; k < g.items.length; k++) {
      const it = g.items[k];
      it.age += dt;
      const s = Math.max(0.001, easeOutBack(Math.min(1, it.age / 420)));
      const x = L.x + (it.x + 0.5) * c, y = L.y + (it.y + 0.5) * c + Math.sin(now * 0.004 + it.seed) * c * 0.07;
      const fade = it.life < 2000 && Math.floor(now / 140) % 2 === 0 ? 0.35 : 1;
      const col = POWERUPS[it.type].color;
      ctx.globalCompositeOperation = th.dark ? 'lighter' : 'source-over';
      ctx.globalAlpha = 0.5 * fade;
      const G = c * 2.8;
      ctx.drawImage(this.glow(col), x - G / 2, y - G / 2, G, G);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, c * 0.05);
      ctx.beginPath(); ctx.arc(x, y, c * (0.56 + 0.1 * Math.sin(now * 0.006 + it.seed)) * s, 0, TAU); ctx.stroke();
      ctx.globalAlpha = fade;
      const S = c * s;
      ctx.drawImage(this.puSprites[it.type], x - S / 2, y - S / 2, S, S);
      ctx.globalAlpha = 1;
    }
  }

  private drawObstacles(g: Game, dt: number) {
    if (!g.obstacles.length) return;
    const ctx = this.ctx, L = g.L, c = L.cell, th = this.theme;
    for (let k = 0; k < g.obstacles.length; k++) {
      const o = g.obstacles[k];
      o.age += dt;
      const s = Math.max(0.001, easeOutBack(Math.min(1, o.age / 500))), S = c * s;
      const x = L.x + o.x * c + (c - S) / 2, y = L.y + o.y * c + (c - S) / 2;
      if (th.dark) {
        const G = c * 2;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16;
        ctx.drawImage(this.glow(th.obstacleEdge), x + S / 2 - G / 2, y + S / 2 - G / 2, G, G);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      ctx.drawImage(this.obstacleSprite, x, y, S, S);
    }
  }

  /* Death: turn segment i into a burst of particles in its body colour */
  disintegrate(g: Game, i: number) {
    const b = g.body[i];
    if (!b) return;
    const c = g.L.cell, n = g.body.length;
    const x = g.L.x + (b.x + 0.5) * c, y = g.L.y + (b.y + 0.5) * c;
    const col = this.lut[Math.round((i / Math.max(1, n - 1)) * (this.lut.length - 1))];
    Particles.burst(x, y, i === 0 ? 16 : CONFIG.particles.perSegment, col, c * 5, 0.9, c * 0.16, c * 2);
  }
}
