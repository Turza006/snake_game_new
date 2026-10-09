'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PU_TYPES, type PowerUpType } from '@/engine/config';
import { SnakeEngine, initialUIState, type UIState } from '@/engine/engine';
import Home from './Home';
import SettingsSheet from './SettingsSheet';
import { DPad, GameOver, Hud, Onboarding, PauseMenu, RotateHint, Toast } from './Screens';

const SERVER_STATE: UIState = initialUIState();
const noopSubscribe = () => () => {};
const serverSnapshot = () => SERVER_STATE;

export type ChipRefs = Record<PowerUpType, { el: HTMLDivElement | null; bar: HTMLElement | null }>;

/**
 * Root of the game. React owns the screens and menus; the SnakeEngine owns the
 * canvas, the loop and the per-frame HUD writes (passed in as DOM refs).
 */
export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const dpadRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const scoreWrapRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<HTMLSpanElement>(null);
  const chipRefs = useRef<ChipRefs>(
    Object.fromEntries(PU_TYPES.map(t => [t, { el: null, bar: null }])) as unknown as ChipRefs,
  );
  const [engine, setEngine] = useState<SnakeEngine | null>(null);

  useEffect(() => {
    const chips = {} as Record<PowerUpType, { el: HTMLElement; bar: HTMLElement }>;
    for (const t of PU_TYPES) chips[t] = { el: chipRefs.current[t].el!, bar: chipRefs.current[t].bar! };
    const e = new SnakeEngine({
      canvas: canvasRef.current!,
      fx: fxRef.current!,
      probe: probeRef.current!,
      dpad: dpadRef.current!,
      score: scoreRef.current!,
      scoreWrap: scoreWrapRef.current!,
      countdown: countdownRef.current!,
      chips,
    });
    setEngine(e);
    return () => e.destroy();
  }, []);

  const ui = useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getSnapshot : serverSnapshot,
    serverSnapshot,
  );

  const s = ui.screen;
  const inRun = s === 'onboarding' || s === 'countdown' || s === 'playing' || s === 'paused' || s === 'dying';
  const dpadOn = ui.settings.controls === 'dpad' && (s === 'onboarding' || s === 'countdown' || s === 'playing' || s === 'paused');

  return (
    <>
      <canvas id="game" ref={canvasRef} aria-hidden="true" />
      <div id="safeProbe" ref={probeRef} aria-hidden="true" />

      <Hud
        visible={inRun}
        canPause={s === 'playing' || s === 'countdown'}
        hud={ui.hud}
        engine={engine}
        scoreRef={scoreRef}
        scoreWrapRef={scoreWrapRef}
        chipRefs={chipRefs}
      />
      <DPad visible={dpadOn} engine={engine} dpadRef={dpadRef} />
      <Home visible={s === 'home'} ui={ui} engine={engine} />
      <Onboarding visible={s === 'onboarding'} />
      <div id="countdown" aria-live="assertive"><span id="cdNum" ref={countdownRef} /></div>
      <PauseMenu visible={s === 'paused'} score={ui.pauseScore} engine={engine} />
      <GameOver visible={s === 'gameover'} info={ui.gameOver} engine={engine} />
      <SettingsSheet open={ui.settingsOpen} settings={ui.settings} hapticsSupported={ui.hapticsSupported} engine={engine} />
      <Toast toast={ui.toast} />
      <RotateHint />
      <canvas id="fx" ref={fxRef} aria-hidden="true" />
    </>
  );
}
