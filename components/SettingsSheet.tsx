import type { CSSProperties, ReactNode } from 'react';
import type { SnakeEngine } from '@/engine/engine';
import type { Settings } from '@/engine/storage';
import { CloseIcon, ControlsIcon, MotionIcon, MusicIcon, PaletteIcon, SoundIcon, VibrateIcon } from './icons';
import { cls } from './Screens';

type ToggleKey = 'sound' | 'music' | 'haptics' | 'reduceMotion';

function SwitchRow({ icon, label, note, checked, disabled, onToggle }: {
  icon: ReactNode; label: string; note?: string; checked: boolean; disabled?: boolean; onToggle: () => void;
}) {
  return (
    <div className="set-row">
      <span className="set-label">{icon}<span>{label}{note && <small>{note}</small>}</span></span>
      <button className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onToggle} />
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.findIndex(o => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': i } as CSSProperties}>
      <span className="ind" aria-hidden="true" />
      {options.map(o => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Settings sheet: animated toggles, controls, theme ---------- */
export default function SettingsSheet({ open, settings, hapticsSupported, engine }: {
  open: boolean; settings: Settings; hapticsSupported: boolean; engine: SnakeEngine | null;
}) {
  const toggle = (k: ToggleKey) => () => engine?.setSetting(k, !settings[k]);
  return (
    <section
      id="settings"
      className={cls('screen', open && 'is-visible')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="setTitle"
      aria-hidden={!open}
      inert={!open}
      onClick={e => { if (e.target === e.currentTarget) engine?.closeSettings(); }}
    >
      <div className="sheet scrollable">
        <div className="grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="setTitle">Settings</h2>
          <button className="icon-btn" aria-label="Close settings" onClick={() => engine?.closeSettings()}><CloseIcon /></button>
        </div>
        <SwitchRow icon={<SoundIcon />} label="Sound effects" checked={settings.sound} onToggle={toggle('sound')} />
        <SwitchRow icon={<MusicIcon />} label="Ambient music" checked={settings.music} onToggle={toggle('music')} />
        <SwitchRow
          icon={<VibrateIcon />}
          label="Haptics"
          note={hapticsSupported ? undefined : 'Not supported on this device'}
          checked={hapticsSupported && settings.haptics}
          disabled={!hapticsSupported}
          onToggle={toggle('haptics')}
        />
        <SwitchRow icon={<MotionIcon />} label="Reduce motion" checked={settings.reduceMotion} onToggle={toggle('reduceMotion')} />
        <div className="set-row stack">
          <span className="set-label"><ControlsIcon />Controls</span>
          <Segmented
            label="Controls"
            value={settings.controls}
            options={[{ value: 'swipe', label: 'Swipe' }, { value: 'dpad', label: 'D-pad' }]}
            onChange={v => engine?.setSetting('controls', v)}
          />
        </div>
        <div className="set-row stack">
          <span className="set-label"><PaletteIcon />Theme</span>
          <Segmented
            label="Theme"
            value={settings.theme}
            options={[
              { value: 'neon', label: <><i className="sw" style={{ background: 'linear-gradient(135deg,#5ef2ff,#b45cff)' }} />Neon</> },
              { value: 'nature', label: <><i className="sw" style={{ background: 'linear-gradient(135deg,#bfe3c6,#2f9e57)' }} />Nature</> },
              { value: 'mono', label: <><i className="sw" style={{ background: 'linear-gradient(135deg,#ffffff,#202024)' }} />Mono</> },
            ]}
            onChange={v => engine?.setSetting('theme', v)}
          />
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" aria-label="Show tutorial again" onClick={() => engine?.resetTutorial()}>Show tutorial again</button>
        </div>
      </div>
    </section>
  );
}
