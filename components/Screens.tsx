import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { MODE_NAMES, POWERUPS, PU_TYPES } from '@/engine/config';
import type { GameOverInfo, SnakeEngine, UIState } from '@/engine/engine';
import { easeOutCubic, fmtTime } from '@/engine/util';
import { ChevronIcon, HomeIcon, PauseIcon, PhoneIcon, PlayIcon, PowerUpIcon, RestartIcon, SlidersIcon } from './icons';
import type { ChipRefs } from './SnakeGame';

export const cls = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* ---------- HUD: score + best + mode/level, power-up chips, pause ---------- */
export function Hud({ visible, canPause, hud, engine, scoreRef, scoreWrapRef, chipRefs }: {
  visible: boolean;
  canPause: boolean;
  hud: UIState['hud'];
  engine: SnakeEngine | null;
  scoreRef: RefObject<HTMLDivElement | null>;
  scoreWrapRef: RefObject<HTMLDivElement | null>;
  chipRefs: RefObject<ChipRefs>;
}) {
  return (
    <header id="hud" className={visible ? 'is-visible' : undefined} inert={!visible}>
      {/* The score text and power-up bars are written by the engine every frame */}
      <div className="score-wrap" ref={scoreWrapRef}>
        <div id="score" ref={scoreRef}>0</div>
        <div id="hudSub">Best {hud.best}</div>
        <div id="hudMode">{MODE_NAMES[hud.mode]} · Lv {hud.level}</div>
      </div>
      <div className="hud-mid">
        {PU_TYPES.map(t => (
          <div
            key={t}
            className="chip"
            style={{ '--pc': POWERUPS[t].color } as CSSProperties}
            aria-label={POWERUPS[t].label + ' active'}
            ref={el => { chipRefs.current[t].el = el; }}
          >
            <PowerUpIcon type={t} />
            <span className="bar"><i ref={el => { chipRefs.current[t].bar = el; }} /></span>
          </div>
        ))}
      </div>
      <button id="pauseBtn" className="icon-btn" aria-label="Pause game" disabled={!canPause} onClick={() => engine?.pause()}>
        <PauseIcon />
      </button>
    </header>
  );
}

/* ---------- D-pad: fires on pointerdown for zero latency ---------- */
const DPAD: Array<[number, string, string]> = [[0, 'Up', '1 / 2'], [3, 'Left', '2 / 1'], [1, 'Right', '2 / 3'], [2, 'Down', '3 / 2']];

export function DPad({ visible, engine, dpadRef }: { visible: boolean; engine: SnakeEngine | null; dpadRef: RefObject<HTMLDivElement | null> }) {
  const release = (e: ReactPointerEvent<HTMLButtonElement>) => e.currentTarget.classList.remove('pressed');
  return (
    <div id="dpad" ref={dpadRef} className={visible ? 'is-visible' : undefined} role="group" aria-label="Direction pad" aria-hidden={!visible} inert={!visible}>
      {DPAD.map(([d, label, area]) => (
        <button
          key={d}
          className="dbtn"
          data-dir={d}
          aria-label={label}
          style={{ gridArea: area }}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.classList.add('pressed'); engine?.direction(d); }}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
        >
          <ChevronIcon />
        </button>
      ))}
    </div>
  );
}

/* ---------- Onboarding (first launch): animated hand, dismissed by the first swipe ---------- */
export function Onboarding({ visible }: { visible: boolean }) {
  return (
    <section id="onboarding" className={cls('screen', visible && 'is-visible')} role="dialog" aria-modal="true" aria-label="How to play" aria-hidden={!visible} inert={!visible}>
      <div className="card onb-card zoom-in">
        <div className="hand-stage" aria-hidden="true">
          <svg className="trail" viewBox="0 0 210 150"><path d="M62 100H152V30" /></svg>
          <svg className="hand" viewBox="0 0 60 80">
            <g fill="#ffffff" stroke="rgba(20,16,50,.22)" strokeWidth="1.5">
              <rect x="33" y="26" width="11" height="22" rx="5.5" />
              <rect x="43" y="30" width="10" height="20" rx="5" />
              <rect x="6" y="38" width="12" height="26" rx="6" transform="rotate(-32 12 51)" />
              <path d="M14 40h39v13c0 13-8 23-20 23h-3c-9 0-16-7-16-16z" />
              <rect x="21" y="2" width="13" height="46" rx="6.5" />
            </g>
          </svg>
        </div>
        <h2>Swipe to steer</h2>
        <p className="only-coarse">Swipe anywhere on the screen.<br />Turns register the moment your finger moves.</p>
        <p className="only-fine">Drag anywhere, or use Arrow keys / WASD.<br />Space pauses the game.</p>
        <div className="onb-tap">Swipe to start</div>
      </div>
    </section>
  );
}

/* ---------- Pause ---------- */
export function PauseMenu({ visible, score, engine }: { visible: boolean; score: number; engine: SnakeEngine | null }) {
  return (
    <section id="pause" className={cls('screen', visible && 'is-visible')} role="dialog" aria-modal="true" aria-label="Paused" aria-hidden={!visible} inert={!visible}>
      <div className="card pause-card zoom-in">
        <h2>Paused</h2>
        <div className="sub">Score <b>{score}</b></div>
        <button className="btn btn-primary btn-wide" aria-label="Resume game" onClick={() => engine?.resume()}><PlayIcon />Resume</button>
        <button className="btn btn-secondary btn-wide" aria-label="Restart run" onClick={() => engine?.restart()}><RestartIcon />Restart</button>
        <div className="row-btns">
          <button className="btn btn-ghost" aria-label="Back to home" onClick={() => engine?.goHome()}><HomeIcon />Home</button>
          <button className="btn btn-ghost" aria-label="Settings" onClick={() => engine?.openSettings()}><SlidersIcon />Settings</button>
        </div>
      </div>
    </section>
  );
}

/* ---------- Game over: card slides up, score counts up, confetti on a new best ---------- */
export function GameOver({ visible, info, engine }: { visible: boolean; info: GameOverInfo | null; engine: SnakeEngine | null }) {
  const scoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scoreRef.current;
    if (!visible || !info || !el) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = easeOutCubic(Math.min(1, (t - t0) / 900));
      el.textContent = String(Math.round(info.score * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, info]);

  return (
    <section id="gameover" className={cls('screen', visible && 'is-visible')} role="dialog" aria-modal="true" aria-label="Game over" aria-hidden={!visible} inert={!visible}>
      <div className={cls('card go-card', info?.isNew && 'new-best')}>
        <span className="badge-best">New Best!</span>
        <div className="go-title">Game over</div>
        <div id="goScore" ref={scoreRef} aria-live="polite">0</div>
        <div id="goMode">{info ? MODE_NAMES[info.mode] + ' · Level ' + info.level : ''}</div>
        <div className="go-stats">
          <div className="stat"><span>Best</span><b>{info?.best ?? 0}</b></div>
          <div className="stat"><span>Length</span><b>{info?.length ?? 0}</b></div>
          <div className="stat"><span>Time</span><b>{fmtTime(info?.timeMs ?? 0)}</b></div>
        </div>
        <button className="btn btn-primary btn-xl" aria-label="Play again" onClick={() => engine?.restart()}><RestartIcon />Play Again</button>
        <button className="btn btn-ghost" aria-label="Back to home" onClick={() => engine?.goHome()}>Home</button>
      </div>
    </section>
  );
}

/* ---------- Toast (level up, mode hints) ---------- */
export function Toast({ toast }: { toast: UIState['toast'] }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShow(false);
    const r = requestAnimationFrame(() => setShow(true));
    const t = window.setTimeout(() => setShow(false), 1400);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [toast]);
  return <div id="toast" role="status" aria-live="polite" className={show ? 'show' : undefined}>{toast?.text}</div>;
}

/* ---------- Landscape phones: ask to rotate (shown by CSS media query) ---------- */
export function RotateHint() {
  return (
    <div id="rotate" role="alert">
      <PhoneIcon />
      <div>Rotate your phone</div>
      <p>Snake is best played in portrait.</p>
    </div>
  );
}
