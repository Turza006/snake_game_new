/* =========================================================================
   STATE MACHINE + LOOP — home → onboarding → countdown → playing ⇄ paused
   → dying → gameover. One rAF loop drives everything. React subscribes to a
   small immutable UI snapshot; per-frame visuals (canvas, HUD score, power-up
   bars, countdown) are written directly so React never re-renders at 60fps.
   ========================================================================= */
import { CONFIG, MODE_HINTS, POWERUPS, PU_TYPES, THEMES, type Mode, type PowerUpType, type ThemeName } from './config';
import { Game, type GameEvents } from './game';
import { Renderer } from './renderer';
import { Confetti, Floats, Particles } from './particles';
import { Haptics, Sound } from './audio';
import { Store, type Settings } from './storage';
import { clamp, setCanvasFontFamily } from './util';

export type Screen = 'boot' | 'home' | 'onboarding' | 'countdown' | 'playing' | 'paused' | 'dying' | 'gameover';

export interface GameOverInfo {
  runId: number; score: number; best: number; length: number; timeMs: number; mode: Mode; level: number; isNew: boolean;
}

export interface UIState {
  screen: Screen;
  settingsOpen: boolean;
  settings: Settings;
  best: Record<Mode, number>;
  mode: Mode;
  hud: { best: number; mode: Mode; level: number };
  pauseScore: number;
  gameOver: GameOverInfo | null;
  toast: { text: string; id: number } | null;
  hapticsSupported: boolean;
}

export interface EngineDom {
  canvas: HTMLCanvasElement;
  fx: HTMLCanvasElement;
  probe: HTMLElement;
  dpad: HTMLElement;
  score: HTMLElement;
  scoreWrap: HTMLElement;
  countdown: HTMLElement;
  chips: Record<PowerUpType, { el: HTMLElement; bar: HTMLElement }>;
}

/* Deterministic snapshot used for server rendering and the first client render */
export function initialUIState(): UIState {
  return {
    screen: 'boot',
    settingsOpen: false,
    settings: { sound: true, music: false, haptics: true, controls: 'swipe', theme: 'neon', reduceMotion: false },
    best: { classic: 0, zen: 0, arcade: 0 },
    mode: 'classic',
    hud: { best: 0, mode: 'classic', level: 1 },
    pauseScore: 0,
    gameOver: null,
    toast: null,
    hapticsSupported: true,
  };
}

export class SnakeEngine {
  private ui: UIState = initialUIState();
  private listeners = new Set<() => void>();
  private readonly dom: EngineDom;
  private readonly R: Renderer;
  private readonly gameEvents: GameEvents;
  private readonly demoEvents: GameEvents;

  private state: Screen = 'boot';
  private game: Game | null = null;
  private demo: Game | null = null;
  private acc = 0;              // fixed-timestep accumulator (ms)
  private demoAcc = 0;
  private alpha = 0;            // interpolation factor between grid steps (0..1)
  private last = 0;
  private stateTime = 0;
  private dirty = true;         // request a redraw while the loop is idle (paused)
  private intro = 1;            // 0→1 fade/zoom-in when a board appears
  private cd = { steps: ['3', '2', '1'], stepMs: 650, idx: -1 };
  private deathCut = 0;
  private raf = 0;
  private disposers: Array<() => void> = [];
  private timers = new Set<number>();

  // input
  private pid: number | null = null;
  private ax = 0; private ay = 0; private swiped = false;

  // HUD (written directly to the DOM)
  private shownScore = 0;
  private lastShown = -1;
  private chipState = {} as Record<PowerUpType, { on: boolean; q: number; warn: boolean }>;
  private fxDirty = false;
  private toastId = 0;
  private runId = 0;
  private perf = { avg: 16.7, slow: 0, downgraded: false };

  constructor(dom: EngineDom) {
    this.dom = dom;
    Store.load();
    this.R = new Renderer(dom.canvas, dom.fx, dom.probe, dom.dpad);
    setCanvasFontFamily(getComputedStyle(document.documentElement).getPropertyValue('--font-outfit').trim());
    for (const t of PU_TYPES) this.chipState[t] = { on: false, q: -1, warn: false };
    this.gameEvents = this.makeGameEvents();
    this.demoEvents = {
      onEat: (g, f) => {
        const c = g.L.cell;
        Particles.burst(g.L.x + (f.x + 0.5) * c, g.L.y + (f.y + 0.5) * c, 10, f.golden ? this.R.theme.golden : this.R.theme.food, c * 5, 0.5, c * 0.11, 0);
      },
    };
    this.applyTheme(Store.data.settings.theme);
    this.applyMotion();
    this.R.fit();
    const d = Store.data;
    this.ui = { ...this.ui, settings: { ...d.settings }, best: { ...d.best }, mode: d.mode, hapticsSupported: Haptics.supported };
    this.bindInput();
    this.bindLifecycle();
    makeTouchIcon();
    this.setState('home');
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ---------- React bridge ---------- */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.ui;
  private patch(p: Partial<UIState>) {
    this.ui = { ...this.ui, ...p };
    this.listeners.forEach(l => l());
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach(d => d());
    this.disposers = [];
    this.timers.forEach(t => clearTimeout(t));
    this.timers.clear();
    this.listeners.clear();
    Particles.clear(); Floats.clear(); Confetti.clear();
  }

  private on<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions | boolean) {
    const h = fn as unknown as EventListener;
    target.addEventListener(type, h, opts);
    this.disposers.push(() => target.removeEventListener(type, h, opts));
  }
  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  /* ---------- Public actions (called by the React UI) ---------- */
  play() { this.startRun(); }
  restart() { if (this.state === 'paused' || this.state === 'gameover') this.startRun(); }
  pause() { if (this.state === 'playing' || this.state === 'countdown') this.setState('paused'); }
  resume() { if (this.state === 'paused' && !this.ui.settingsOpen) this.setState('countdown', { resume: true }); }
  goHome() { if (this.state === 'paused' || this.state === 'gameover') this.setState('home'); }
  openSettings() { if (!this.ui.settingsOpen) this.patch({ settingsOpen: true }); }
  closeSettings() { if (this.ui.settingsOpen) this.patch({ settingsOpen: false }); }
  direction(d: number) { this.onDirection(d); }
  resetTutorial() { Store.data.onboarded = false; Store.save(); this.toast('Tutorial on next run'); }

  setMode(m: Mode) {
    if (Store.data.mode === m) return;
    Store.data.mode = m;
    Store.save();
    this.patch({ mode: m });
  }

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
    if (k === 'haptics' && !Haptics.supported) return;
    if (Store.data.settings[k] === v) return;
    Store.data.settings[k] = v;
    Store.save();
    switch (k) {
      case 'sound': case 'music': Sound.unlock(); Sound.applySettings(); break;
      case 'haptics': if (v) Haptics.fire(20); break;
      case 'theme': this.applyTheme(v as ThemeName); break;
      case 'reduceMotion': this.applyMotion(); break;
      case 'controls': if (this.game) this.R.layoutGame(this.game, v === 'dpad'); break;
    }
    this.dirty = true;
    this.patch({ settings: { ...Store.data.settings } });
  }

  /* ---------- State machine ---------- */
  private setState(next: Screen, opts?: { resume?: boolean }) {
    this.state = next;
    this.stateTime = 0;
    this.dirty = true;
    switch (next) {
      case 'home':
        this.game = null;
        this.ensureDemo(false);
        this.intro = 0;
        Particles.clear(); Floats.clear();
        break;
      case 'countdown': {
        const resume = !!opts?.resume;
        this.cd.stepMs = resume ? CONFIG.timing.resumeStep : CONFIG.timing.countdownStep;
        this.cd.idx = -1;
        if (!resume && this.game) this.toast(MODE_HINTS[this.game.mode as Mode]);   // say which rules apply
        break;
      }
      case 'dying':
        this.deathCut = 0;
        break;
    }
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
    if (next !== 'countdown' && next !== 'playing') this.clearCountdown();
    const p: Partial<UIState> = { screen: next };
    if (next === 'paused') p.pauseScore = this.game ? this.game.score : 0;
    if (next === 'home') p.best = { ...Store.data.best };
    if (next === 'gameover' && this.game) this.finishRun(this.game, p);
    this.patch(p);
  }

  private startRun() {
    const s = this.state;
    if (s !== 'home' && s !== 'gameover' && s !== 'paused') return;   // guards rapid taps
    const dpadOn = Store.data.settings.controls === 'dpad';
    const dims = this.R.gridFor(this.R.playArea(dpadOn));
    const g = new Game(dims.cols, dims.rows, Store.data.mode, { events: this.gameEvents });
    this.game = g;
    this.R.layoutGame(g, dpadOn);
    Particles.clear(); Floats.clear();
    this.R.shake = 0; this.R.zoom = 0; this.R.flash = 0;
    this.acc = 0; this.alpha = 0; this.intro = 0;
    this.resetHud(g);
    this.setState(Store.data.onboarded ? 'countdown' : 'onboarding');
  }

  private finishRun(g: Game, p: Partial<UIState>) {
    const mode = g.mode as Mode;
    const prevBest = Store.data.best[mode] || 0, isNew = g.score > prevBest;
    if (isNew) { Store.data.best[mode] = g.score; Store.save(); }
    p.best = { ...Store.data.best };
    p.gameOver = { runId: ++this.runId, score: g.score, best: Math.max(prevBest, g.score), length: g.body.length, timeMs: g.time, mode, level: g.level, isNew };
    if (isNew) this.later(() => {
      if (this.state !== 'gameover') return;
      this.confetti();
      Sound.newBest();
      Haptics.fire([30, 60, 30, 60, 90]);
    }, 420);
  }

  private autoPause() { this.pause(); }

  private dismissOnboarding() {
    if (this.state !== 'onboarding') return;
    Store.data.onboarded = true;
    Store.save();
    this.pid = null;                               // ignore the rest of this gesture
    this.setState('countdown');
  }

  private onDirection(d: number) {
    const s = this.state;
    if (s === 'onboarding') { this.dismissOnboarding(); return; }
    if ((s === 'playing' || s === 'countdown') && this.game && this.game.queueDir(d)) Sound.turn();
  }

  private ensureDemo(force: boolean) {
    const c = CONFIG.render.demoCell, R = this.R;
    const cols = Math.ceil(R.vw / c) + 1, rows = Math.ceil(R.vh / c) + 1;
    if (force || !this.demo || this.demo.cols !== cols || this.demo.rows !== rows) {
      this.demo = new Game(cols, rows, 'demo', { events: this.demoEvents, demo: true });
      this.demoAcc = 0;
    }
    R.layoutDemo(this.demo, c);
  }

  private updateCountdown() {
    const cd = this.cd, idx = Math.floor(this.stateTime / cd.stepMs);
    if (idx === cd.idx) return;
    cd.idx = idx;
    if (idx < cd.steps.length) { this.countdownShow(cd.steps[idx], false); Sound.count(false); }
    else { this.countdownShow('GO', true); Sound.count(true); this.setState('playing'); }
  }

  /* ---------- Loop ---------- */
  private frame = (ts: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.last) this.last = ts;
    let dt = ts - this.last;
    this.last = ts;
    if (dt > 200) dt = 200; else if (dt < 0) dt = 0;   // clamp after tab switches / hitches
    this.update(dt);
  };

  private update(dt: number) {
    this.stateTime += dt;
    this.samplePerf(dt);
    Sound.tickMusic();
    if (this.intro < 1) this.intro = Math.min(1, this.intro + dt / CONFIG.timing.introMs);
    const R = this.R, g = this.game;

    switch (this.state) {
      case 'home': {
        const d = this.demo;
        if (!d) break;
        d.update(dt);
        this.demoAcc += dt;
        const tick = d.tickMs();
        let n = 0;
        while (this.demoAcc >= tick && n++ < 4) {
          this.demoAcc -= tick;
          d.aiStep();
          if (!d.alive) d.reset();
        }
        if (this.demoAcc > tick) this.demoAcc = 0;
        Particles.update(dt); Floats.update(dt);
        R.render(d, this.demoAcc / tick, dt, 0, this.intro);
        break;
      }
      case 'onboarding':
        if (g) R.render(g, 0, dt, 0, this.intro);
        break;
      case 'countdown':
        this.updateCountdown();
        Particles.update(dt); Floats.update(dt);
        if (g) R.render(g, this.alpha, dt, 0, this.intro);
        break;
      case 'playing': {
        if (!g) break;
        g.update(dt);                                     // real-time timers (power-ups, golden food)
        this.acc += dt;
        let tick = g.tickMs(), n = 0;
        while (this.acc >= tick && g.alive && n++ < 4) {   // fixed-timestep grid logic
          this.acc -= tick;
          g.step();
          tick = g.tickMs();
        }
        if (!g.alive) { this.acc = 0; this.alpha = 0; this.setState('dying'); }
        else { if (this.acc > tick) this.acc = tick; this.alpha = this.acc / tick; }
        Particles.update(dt); Floats.update(dt);
        R.render(g, this.alpha, dt, 0, this.intro);
        break;
      }
      case 'dying': {
        if (!g) break;
        const T = CONFIG.timing, t = this.stateTime;
        const slow = t < T.deathSlowMs;
        const sdt = slow ? dt * T.deathTimeScale : dt;    // brief slow-motion moment
        if (!slow) {                                       // then the body dissolves head → tail
          const p = clamp((t - T.deathSlowMs) / (T.deathTotalMs - T.deathSlowMs - 200), 0, 1);
          const target = Math.ceil(p * g.body.length);
          while (this.deathCut < target) R.disintegrate(g, this.deathCut++);
        }
        Particles.update(sdt); Floats.update(sdt);
        R.render(g, 0, sdt, this.deathCut, this.intro);
        if (t >= T.deathTotalMs) this.setState('gameover');
        break;
      }
      case 'gameover':
        if (g && (Particles.live || Floats.live || this.dirty)) {
          Particles.update(dt); Floats.update(dt);
          R.render(g, 0, dt, g.body.length, this.intro);
          this.dirty = false;
        }
        break;
      case 'paused':
        if (this.dirty && g) { R.render(g, this.alpha, 0, 0, 1); this.dirty = false; }
        break;
    }
    if (g && (this.state === 'playing' || this.state === 'dying' || this.state === 'countdown')) this.updateHud(g, dt);
    this.updateConfetti(dt);
  }

  /* Adaptive quality: if a device can't hold ~45fps, lower resolution once. */
  private samplePerf(dt: number) {
    const P = this.perf;
    if (P.downgraded || this.state !== 'playing' || dt <= 0 || dt > 100) return;
    P.avg += (dt - P.avg) * 0.05;
    if (P.avg > CONFIG.render.slowFrameMs) {
      if (++P.slow > 150) {
        P.downgraded = true;
        this.R.maxDpr = Math.min(this.R.maxDpr, CONFIG.render.lowDpr);
        this.applyMotion();
        this.R.fit();
        if (this.game) this.R.layoutGame(this.game, Store.data.settings.controls === 'dpad');
      }
    } else P.slow = 0;
  }

  /* ---------- Direct DOM writes (per frame) ---------- */
  private resetHud(g: Game) {
    this.shownScore = 0; this.lastShown = -1;
    this.dom.score.textContent = '0';
    for (const t of PU_TYPES) {
      const c = this.chipState[t];
      c.on = false; c.warn = false; c.q = -1;
      this.dom.chips[t].el.classList.remove('on', 'warn');
    }
    this.patch({ hud: { best: Store.data.best[g.mode as Mode] || 0, mode: g.mode as Mode, level: 1 } });
  }

  private updateHud(g: Game, dt: number) {
    const target = g.score;
    if (this.shownScore < target) {                       // smooth count-up
      this.shownScore += Math.max(dt * 0.05, (target - this.shownScore) * Math.min(1, dt * 0.012));
      if (this.shownScore > target) this.shownScore = target;
    }
    const v = Math.floor(this.shownScore);
    if (v !== this.lastShown) { this.lastShown = v; this.dom.score.textContent = String(v); }
    for (let k = 0; k < PU_TYPES.length; k++) {
      const t = PU_TYPES[k], c = this.chipState[t], el = this.dom.chips[t], rem = g.active[t], on = rem > 0;
      if (on !== c.on) { c.on = on; el.el.classList.toggle('on', on); c.q = -1; }
      if (!on) continue;
      const q = Math.round((rem / CONFIG.powerUps.durationMs) * 100);   // only touch the DOM when it changes
      if (q !== c.q) { c.q = q; el.bar.style.transform = 'scaleX(' + q / 100 + ')'; }
      const warn = rem < CONFIG.powerUps.warnMs;
      if (warn !== c.warn) { c.warn = warn; el.el.classList.toggle('warn', warn); }
    }
  }

  private bumpScore() {
    const w = this.dom.scoreWrap;
    w.classList.remove('bump'); void w.offsetWidth; w.classList.add('bump');
  }

  private countdownShow(text: string, go: boolean) {
    const el = this.dom.countdown;
    el.textContent = text;
    el.className = '';
    void el.offsetWidth;                                  // restart the CSS animation
    el.className = go ? 'cd-go' : 'cd-anim';
  }
  private clearCountdown() { this.dom.countdown.className = ''; this.dom.countdown.textContent = ''; }

  private toast(text: string) { this.patch({ toast: { text, id: ++this.toastId } }); }

  private confetti() {
    const R = this.R, cols = R.theme.confetti, n = Math.round(150 * (Store.data.settings.reduceMotion ? 0.35 : 1));
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const a = left ? -Math.PI / 2 + 0.2 + Math.random() * 0.85 : -Math.PI / 2 - 0.2 - Math.random() * 0.85;
      const s = 520 + Math.random() * 640;
      const p = Confetti.spawn(left ? -10 : R.vw + 10, R.vh * 0.55, Math.cos(a) * s, Math.sin(a) * s,
        2.2 + Math.random() * 1.3, 7 + Math.random() * 6, cols[i % cols.length], 820, 1.6, 1);
      p.vr = (Math.random() * 2 - 1) * 14;
    }
  }

  private updateConfetti(dt: number) {
    const R = this.R, fx = R.fx;
    if (Confetti.live) {
      fx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      fx.clearRect(0, 0, R.vw, R.vh);
      Confetti.update(dt);
      Confetti.draw(fx, 'source-over');
      this.fxDirty = true;
    } else if (this.fxDirty) {
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.clearRect(0, 0, R.fxCv.width, R.fxCv.height);
      this.fxDirty = false;
    }
  }

  /* ---------- Settings side-effects ---------- */
  private applyTheme(name: ThemeName) {
    const th = THEMES[name] || THEMES.neon, root = document.documentElement;
    for (const k in th.ui) root.style.setProperty(k, th.ui[k]);
    root.dataset.theme = name;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th.meta);
    this.R.setTheme(th);
    if (this.game) this.R.layoutGame(this.game, Store.data.settings.controls === 'dpad');
  }

  private applyMotion() {
    const reduced = Store.data.settings.reduceMotion;
    document.documentElement.classList.toggle('reduce-motion', reduced);
    const b = (reduced ? 0.35 : 1) * (this.perf.downgraded ? 0.6 : 1);
    Particles.budget = b;
    Confetti.budget = b;
    this.R.reduced = reduced;
  }

  /* ---------- Game → feedback wiring (particles, audio, haptics, HUD) ---------- */
  private makeGameEvents(): GameEvents {
    return {
      onEat: (g, f, pts, combo) => {
        const th = this.R.theme, L = g.L, c = L.cell;
        const x = L.x + (f.x + 0.5) * c, y = L.y + (f.y + 0.5) * c;
        const col = f.golden ? th.golden : th.food;
        Particles.burst(x, y, f.golden ? CONFIG.particles.golden : CONFIG.particles.eat, col, c * (f.golden ? 9 : 7), 0.6, c * 0.13, 0);
        Particles.ring(x, y, col, c * 0.35, 0.45);
        const tx = clamp(x, L.x + c * 1.5, L.x + L.w - c * 1.5);
        Floats.spawn('+' + pts, tx, y - c * 0.5, f.golden ? th.golden : th.floatText, c * (f.golden ? 0.95 : 0.78));
        if (combo >= 2) {
          Floats.spawn('COMBO x' + Math.min(combo, CONFIG.combo.maxMult), tx, y - c * 1.5, th.combo, c * 0.85);
          this.R.zoom = 0.035;
        }
        if (f.golden) Sound.golden(); else Sound.eat(combo);
        Haptics.fire(f.golden ? [18, 40, 18] : 12);
        this.bumpScore();
      },
      onLevel: (g, lvl) => {
        this.toast('Level ' + lvl + ' · Faster');
        this.patch({ hud: { ...this.ui.hud, level: lvl } });
        Sound.levelUp();
        Haptics.fire([10, 30, 10, 30, 10]);
      },
      onPowerUp: (g, type, it) => {
        const L = g.L, c = L.cell, x = L.x + (it.x + 0.5) * c, y = L.y + (it.y + 0.5) * c, col = POWERUPS[type].color;
        Particles.burst(x, y, 26, col, c * 8, 0.7, c * 0.13, 0);
        Particles.ring(x, y, col, c * 0.4, 0.6);
        Floats.spawn(POWERUPS[type].label.toUpperCase(), clamp(x, L.x + c * 2.5, L.x + L.w - c * 2.5), y - c, col, c * 0.8);
        Sound.powerUp();
        Haptics.fire([20, 40, 20]);
      },
      onPowerEnd: () => Sound.powerDown(),
      onExpire: (g, obj) => {
        const L = g.L, c = L.cell;
        const col = 'type' in obj ? POWERUPS[obj.type].color : this.R.theme.golden;
        Particles.burst(L.x + (obj.x + 0.5) * c, L.y + (obj.y + 0.5) * c, 10, col, c * 3, 0.5, c * 0.1, 0);
      },
      onObstacle: (g, o) => {
        const L = g.L, c = L.cell;
        Particles.burst(L.x + (o.x + 0.5) * c, L.y + (o.y + 0.5) * c, 12, this.R.theme.obstacleEdge, c * 4, 0.5, c * 0.1, 0);
        Sound.thud();
      },
      onDie: (g) => {
        const th = this.R.theme, L = g.L, c = L.cell, h = g.body[0];
        const x = L.x + (h.x + 0.5) * c, y = L.y + (h.y + 0.5) * c;
        Particles.burst(x, y, 28, th.snakeHead, c * 10, 0.9, c * 0.16, 0);
        Particles.ring(x, y, th.snakeHead, c * 0.5, 0.7);
        Sound.death();
        Haptics.fire([70, 50, 140]);
        if (!Store.data.settings.reduceMotion) { this.R.shake = c * 0.55; this.R.flash = 1; }
      },
    };
  }

  /* ---------- Input: swipes register during pointermove (no waiting for touchend) ---------- */
  private bindInput() {
    const passive = { passive: true }, active = { passive: false };
    this.on<PointerEvent>(window, 'pointerdown', e => {
      Sound.unlock();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target as Element | null;
      if (t && t.closest && t.closest('button, .carousel, .sheet')) { this.pid = null; return; }   // UI handles its own
      this.pid = e.pointerId;
      this.ax = e.clientX; this.ay = e.clientY;
      this.swiped = false;
    }, passive);
    this.on<PointerEvent>(window, 'pointermove', e => {
      if (e.pointerId !== this.pid) return;
      const th = CONFIG.input.swipeThreshold;
      const dx = e.clientX - this.ax, dy = e.clientY - this.ay;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < th && ady < th) return;
      const d = adx > ady ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      // Re-anchor so the same finger can keep steering (e.g. up then left in one stroke)
      this.ax = e.clientX; this.ay = e.clientY;
      this.swiped = true;
      this.onDirection(d);
    }, passive);
    this.on<PointerEvent>(window, 'pointerup', e => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      if (!this.swiped && this.state === 'onboarding') this.dismissOnboarding();
    }, passive);
    this.on<PointerEvent>(window, 'pointercancel', e => { if (e.pointerId === this.pid) this.pid = null; }, passive);
    this.on<KeyboardEvent>(window, 'keydown', e => this.onKey(e));

    // Never let the page scroll, bounce, pinch-zoom or show long-press menus
    this.on<TouchEvent>(document, 'touchmove', e => {
      const t = e.target as Element | null;
      if (!(t && t.closest && t.closest('.scrollable'))) e.preventDefault();
    }, active);
    this.on<TouchEvent>(document, 'touchstart', e => { Sound.unlock(); if (e.touches.length > 1) e.preventDefault(); }, active);
    this.on(document, 'touchend', () => Sound.unlock(), passive);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) this.on(document, t, e => e.preventDefault(), active);
    this.on(document, 'contextmenu', e => e.preventDefault());
    this.on(document, 'dblclick', e => e.preventDefault(), active);
    this.on(document, 'selectstart', e => e.preventDefault());
    this.on<MouseEvent>(document, 'click', e => {
      const b = (e.target as Element | null)?.closest?.('button');
      if (b && !b.classList.contains('dbtn')) Sound.tap();
    });
  }

  private onKey(e: KeyboardEvent) {
    const k = e.key;
    Sound.unlock();
    if (this.ui.settingsOpen) {
      if (k === 'Escape') { e.preventDefault(); this.closeSettings(); }
      return;
    }
    let d = -1;
    switch (k) {
      case 'ArrowUp': case 'w': case 'W': d = 0; break;
      case 'ArrowRight': case 'd': case 'D': d = 1; break;
      case 'ArrowDown': case 's': case 'S': d = 2; break;
      case 'ArrowLeft': case 'a': case 'A': d = 3; break;
    }
    const st = this.state;
    const ae = document.activeElement;
    const onButton = !!ae && ae.tagName === 'BUTTON';
    if (d >= 0) {
      // Steering keys only steer; they never change the selected mode on the home screen
      e.preventDefault();
      if (st !== 'home') this.onDirection(d);
      return;
    }
    if (e.repeat) return;
    if (k === ' ' || k === 'Spacebar' || k === 'p' || k === 'P' || k === 'Escape') {
      if (st === 'playing' || st === 'countdown' || st === 'paused') { e.preventDefault(); if (st === 'paused') this.resume(); else this.pause(); }
      else if (st === 'onboarding') { e.preventDefault(); this.dismissOnboarding(); }
      else if (k === ' ' && !onButton && (st === 'home' || st === 'gameover')) { e.preventDefault(); this.startRun(); }
      return;
    }
    if (k === 'Enter' && !onButton) {
      if (st === 'home' || st === 'gameover') { e.preventDefault(); this.startRun(); }
      else if (st === 'paused') { e.preventDefault(); this.resume(); }
      else if (st === 'onboarding') { e.preventDefault(); this.dismissOnboarding(); }
    }
  }

  /* ---------- Lifecycle: resize, backgrounding, rotation ---------- */
  private bindLifecycle() {
    let resizeTimer = 0;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => this.handleResize(), 120); };
    this.disposers.push(() => clearTimeout(resizeTimer));
    this.on(window, 'resize', onResize);
    this.on(window, 'orientationchange', onResize);
    if (window.visualViewport) this.on(window.visualViewport, 'resize', onResize);

    // Auto-pause whenever the app is backgrounded or loses focus
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) { this.autoPause(); Sound.suspend(); }
      else { Sound.resume(); this.last = 0; }
    });
    this.on(window, 'blur', () => this.autoPause());
    this.on(window, 'pagehide', () => this.autoPause());
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
    this.on(mq, 'change', () => { if (mq.matches) this.autoPause(); });
    document.fonts?.ready.then(() => { this.dirty = true; }).catch(() => {});
  }

  private handleResize() {
    const pw = this.R.vw, ph = this.R.vh;
    this.R.fit();
    if (this.game) this.R.layoutGame(this.game, Store.data.settings.controls === 'dpad');
    if (this.state === 'home') this.ensureDemo(false);
    // Only pause on a real layout change (not the mobile URL bar nudging the height)
    if (Math.abs(this.R.vw - pw) > 1 || Math.abs(this.R.vh - ph) > 120) this.autoPause();
    this.dirty = true;
  }
}

/* Home-screen icon for iOS (PNG generated at runtime; iOS ignores SVG touch icons) */
function makeTouchIcon() {
  if (document.querySelector('link[rel="apple-touch-icon"]')) return;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 180, 180);
    grd.addColorStop(0, '#141a4a'); grd.addColorStop(1, '#3a1066');
    g.fillStyle = grd; g.fillRect(0, 0, 180, 180);
    const sg = g.createLinearGradient(30, 0, 150, 0);
    sg.addColorStop(0, '#b45cff'); sg.addColorStop(1, '#5ef2ff');
    g.strokeStyle = sg; g.lineWidth = 26; g.lineCap = 'round';
    g.beginPath(); g.moveTo(40, 128); g.bezierCurveTo(40, 80, 90, 100, 96, 70); g.quadraticCurveTo(102, 46, 132, 52); g.stroke();
    g.fillStyle = '#5ef2ff'; g.beginPath(); g.arc(136, 52, 19, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(141, 46, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#120a2e'; g.beginPath(); g.arc(143, 46, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff4f8b'; g.beginPath(); g.arc(134, 130, 12, 0, Math.PI * 2); g.fill();
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = c.toDataURL('image/png');
    document.head.appendChild(link);
  } catch { /* non-essential */ }
}
