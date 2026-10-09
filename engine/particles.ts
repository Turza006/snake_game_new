/* =========================================================================
   PARTICLES — fixed pools, round-robin reuse, zero allocations per frame
   ========================================================================= */
import { CONFIG, TAU } from './config';
import { easeOutBack, easeOutCubic, fontFor } from './util';

interface Particle {
  on: boolean; x: number; y: number; vx: number; vy: number; life: number; max: number;
  size: number; color: string; grav: number; drag: number; kind: number; rot: number; vr: number;
}

export class ParticleSystem {
  private items: Particle[] = [];
  private cursor = 0;
  live = 0;
  budget = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.items.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', grav: 0, drag: 3, kind: 0, rot: 0, vr: 0 });
    }
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, grav: number, drag: number, kind: number) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
    p.size = size; p.color = color; p.grav = grav; p.drag = drag; p.kind = kind; p.rot = Math.random() * TAU; p.vr = 0;
    this.live++;
    return p;
  }

  /* kind 0 = glowing spark */
  burst(x: number, y: number, count: number, color: string, speed: number, life: number, size: number, grav: number) {
    const n = Math.max(1, Math.round(count * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), size * (0.6 + Math.random() * 0.7), color, grav, 3, 0);
    }
  }

  /* kind 2 = expanding shockwave ring */
  ring(x: number, y: number, color: string, size: number, life: number) { this.spawn(x, y, 0, 0, life, size, color, 0, 0, 2); }

  update(dt: number) {
    if (!this.live) return;
    const s = dt / 1000;
    let live = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.on) continue;
      p.life -= s;
      if (p.life <= 0) { p.on = false; continue; }
      const k = 1 / (1 + p.drag * s);
      p.vx *= k; p.vy *= k;
      p.vy += p.grav * s;
      p.x += p.vx * s; p.y += p.vy * s;
      p.rot += p.vr * s;
      live++;
    }
    this.live = live;
  }

  draw(ctx: CanvasRenderingContext2D, blend: GlobalCompositeOperation) {
    if (!this.live) return;
    ctx.globalCompositeOperation = blend;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.on) continue;
      const t = p.life / p.max;
      ctx.globalAlpha = t < 0.5 ? t * 2 : 1;
      if (p.kind === 0) {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.3, p.size * (0.35 + 0.65 * t)), 0, TAU); ctx.fill();
      } else if (p.kind === 1) {                                        // confetti: fake 3D flip
        ctx.fillStyle = p.color;
        const w = p.size * Math.abs(Math.cos(p.rot)) + 0.5, h = p.size * 0.6;
        ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
      } else {
        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.5, 3 * t);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - t) * 3.2), 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear() { for (let i = 0; i < this.items.length; i++) this.items[i].on = false; this.live = 0; }
}

/* Floating "+10" / "COMBO x3" labels that pop, rise and fade */
interface Label { on: boolean; text: string; x: number; y: number; life: number; max: number; color: string; size: number; font: string; rise: number }

export class FloatText {
  private items: Label[] = [];
  private cursor = 0;
  live = 0;

  constructor(size: number) {
    for (let i = 0; i < size; i++) this.items.push({ on: false, text: '', x: 0, y: 0, life: 0, max: 1, color: '#fff', size: 16, font: '', rise: 40 });
  }

  spawn(text: string, x: number, y: number, color: string, size: number) {
    const f = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    f.on = true; f.text = text; f.x = x; f.y = y; f.color = color; f.size = size; f.font = fontFor(size);
    f.life = f.max = 0.95; f.rise = size * 2.4;
    this.live++;
  }

  update(dt: number) {
    if (!this.live) return;
    const s = dt / 1000;
    let live = 0;
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (!f.on) continue;
      if ((f.life -= s) <= 0) { f.on = false; continue; }
      live++;
    }
    this.live = live;
  }

  draw(ctx: CanvasRenderingContext2D, outline: string) {
    if (!this.live) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (!f.on) continue;
      const t = 1 - f.life / f.max;
      const sc = t < 0.15 ? Math.max(0.05, easeOutBack(t / 0.15)) : 1;
      ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      ctx.font = f.font;
      ctx.save();
      ctx.translate(f.x, f.y - easeOutCubic(t) * f.rise);
      ctx.scale(sc, sc);
      ctx.lineWidth = f.size * 0.22; ctx.strokeStyle = outline; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  clear() { for (let i = 0; i < this.items.length; i++) this.items[i].on = false; this.live = 0; }
}

export const Particles = new ParticleSystem(CONFIG.particles.pool);
export const Confetti = new ParticleSystem(CONFIG.particles.fxPool);
export const Floats = new FloatText(16);
