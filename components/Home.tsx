import { useEffect, useRef, type CSSProperties } from 'react';
import { MODE_INFO, MODE_NAMES, MODES, type Mode } from '@/engine/config';
import type { SnakeEngine, UIState } from '@/engine/engine';
import { clamp } from '@/engine/util';
import { CrownIcon, GearIcon, ModeIcon, PlayIcon } from './icons';
import { cls } from './Screens';

const MODE_COLOR: Record<Mode, string> = { classic: 'var(--accent)', zen: 'var(--accent3)', arcade: 'var(--accent2)' };

/* ---------- Home: logo, swipeable mode cards, Play (the AI demo snake runs behind) ---------- */
export default function Home({ visible, ui, engine }: { visible: boolean; ui: UIState; engine: SnakeEngine | null }) {
  return (
    <section id="home" className={cls('screen', visible && 'is-visible')} aria-label="Home" aria-hidden={!visible} inert={!visible}>
      <div className="home-bar pop">
        <div className="best-pill" aria-label="Best score for selected mode">
          <CrownIcon />
          <span>Best</span><b>{ui.best[ui.mode]}</b>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={() => engine?.openSettings()}><GearIcon /></button>
      </div>

      <div className="logo pop" style={{ '--d': '60ms' } as CSSProperties}>
        <svg className="logo-mark" viewBox="0 0 160 70" aria-hidden="true">
          <defs>
            <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--accent3)' }} />
              <stop offset="1" style={{ stopColor: 'var(--accent)' }} />
            </linearGradient>
          </defs>
          <path className="lm-body" pathLength={100} d="M14 52C34 52 34 18 58 18S82 52 106 52S128 26 138 22" />
          <g className="lm-head">
            <circle cx="140" cy="21" r="11" style={{ fill: 'var(--accent)' }} />
            <circle cx="143.5" cy="17" r="3.4" fill="#fff" />
            <circle cx="144.5" cy="17" r="1.7" fill="#0a0f2c" />
          </g>
          <circle className="lm-food" cx="151" cy="52" r="5.5" style={{ fill: 'var(--accent2)' }} />
        </svg>
        <h1 className="logo-title">SNAKE</h1>
        <p className="logo-tag">Glide · Eat · Grow</p>
      </div>

      <div className="mode-select pop" style={{ '--d': '120ms' } as CSSProperties}>
        <Carousel mode={ui.mode} best={ui.best} onSelect={m => engine?.setMode(m)} />
      </div>

      <button className="btn btn-primary btn-xl play-btn pop" style={{ '--d': '180ms' } as CSSProperties} aria-label="Play" onClick={() => engine?.play()}>
        <PlayIcon />Play
      </button>
    </section>
  );
}

/* ---------- Mode carousel: custom drag + spring snap; cards are buttons (Tab + Enter works) ---------- */
interface Drag { id: number; x0: number; base: number; lastX: number; lastT: number; v: number; moved: boolean }

class CarouselCtl {
  idx: number;
  private x = 0;
  private cw = 250;
  private readonly gap = 14;
  private drag: Drag | null = null;
  private suppress = false;
  private off: Array<() => void> = [];

  constructor(private el: HTMLDivElement, private track: HTMLDivElement, private cards: HTMLButtonElement[], idx: number, private onSelect: (i: number) => void) {
    this.idx = idx;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.suppress = false;
      const now = performance.now();
      this.drag = { id: e.pointerId, x0: e.clientX, base: this.x, lastX: e.clientX, lastT: now, v: 0, moved: false };
      this.el.classList.add('dragging');
      this.track.style.transition = 'none';
    };
    const move = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0;
      if (Math.abs(dx) > 8) d.moved = true;
      const now = performance.now(), dt = now - d.lastT;
      if (dt > 0) { d.v = (e.clientX - d.lastX) / dt; d.lastX = e.clientX; d.lastT = now; }
      let x = d.base + dx;
      const min = this.offsetFor(this.cards.length - 1), max = this.offsetFor(0);
      if (x > max) x = max + (x - max) * 0.35; else if (x < min) x = min + (x - min) * 0.35;   // rubber band
      this.x = x;
      this.apply();
    };
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.el.classList.remove('dragging');
      if (!d.moved) { this.select(this.idx); return; }
      this.suppress = true;                                   // swallow the click that follows a drag
      let target = Math.round((this.offsetFor(0) - this.x) / (this.cw + this.gap));
      if (Math.abs(d.v) > 0.35 && performance.now() - d.lastT < 120) target = this.idx + (d.v < 0 ? 1 : -1);
      this.select(target);
    };
    const resize = () => this.layout();
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('resize', resize);
    this.off.push(() => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('resize', resize);
    });
    this.layout();
  }

  destroy() { this.off.forEach(f => f()); }

  click(i: number) {
    if (this.suppress) { this.suppress = false; return; }
    this.select(i);
  }

  private width() { return this.el.clientWidth || window.innerWidth; }
  private offsetFor(i: number) { return this.width() / 2 - (i * (this.cw + this.gap) + this.cw / 2); }

  layout() {
    this.cw = Math.round(clamp(this.width() * 0.7, 200, 260));
    this.el.style.setProperty('--card-w', this.cw + 'px');
    this.select(this.idx, false, true);
  }

  select(i: number, animate = true, silent = false) {
    i = clamp(i, 0, this.cards.length - 1);
    const changed = i !== this.idx;
    this.idx = i;
    this.x = this.offsetFor(i);
    this.track.style.transition = animate ? 'transform .55s var(--ease-spring)' : 'none';
    this.apply();
    if (changed && !silent) this.onSelect(i);
  }

  private apply() {
    this.track.style.transform = 'translate3d(' + this.x.toFixed(1) + 'px,0,0)';
    const w = this.width(), step = this.cw + this.gap;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i], center = this.x + i * step + this.cw / 2;
      const k = Math.min(1, Math.abs(center - w / 2) / step);
      c.style.transform = 'scale(' + (1 - 0.08 * k).toFixed(3) + ')';
      c.style.opacity = (1 - 0.5 * k).toFixed(3);
    }
  }
}

function Carousel({ mode, best, onSelect }: { mode: Mode; best: Record<Mode, number>; onSelect: (m: Mode) => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ctl = useRef<CarouselCtl | null>(null);
  const onSelectRef = useRef(onSelect);
  const modeRef = useRef(mode);

  useEffect(() => { onSelectRef.current = onSelect; modeRef.current = mode; });

  useEffect(() => {
    const c = new CarouselCtl(elRef.current!, trackRef.current!, cardRefs.current as HTMLButtonElement[],
      Math.max(0, MODES.indexOf(modeRef.current)), i => onSelectRef.current(MODES[i]));
    ctl.current = c;
    return () => { c.destroy(); ctl.current = null; };
  }, []);

  // Follow external changes (e.g. the saved mode loading after mount)
  useEffect(() => { ctl.current?.select(MODES.indexOf(mode), true, true); }, [mode]);

  return (
    <>
      <div className="carousel" id="carousel" ref={elRef} role="group" aria-label="Game mode">
        <div className="track" ref={trackRef}>
          {MODES.map((m, i) => (
            <button
              key={m}
              ref={el => { cardRefs.current[i] = el; }}
              className={cls('mode-card', m === mode && 'active')}
              aria-label={MODE_NAMES[m] + ' mode'}
              aria-pressed={m === mode}
              style={{ '--mc': MODE_COLOR[m] } as CSSProperties}
              onClick={() => ctl.current?.click(i)}
            >
              <span className="mode-top">
                <span className="mode-icon"><ModeIcon mode={m} /></span>
                <span className="mode-name">{MODE_NAMES[m]}</span>
              </span>
              <span className="mode-desc">{MODE_INFO[m]}</span>
              <span className="mode-best">Best <b>{best[m]}</b></span>
            </button>
          ))}
        </div>
      </div>
      <div className="dots" aria-hidden="true">
        {MODES.map(m => <i key={m} className={m === mode ? 'on' : undefined} />)}
      </div>
    </>
  );
}
