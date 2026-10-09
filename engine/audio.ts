/* =========================================================================
   AUDIO — everything synthesised with Web Audio. The context is created on
   the first user gesture (autoplay policies) and suspended when hidden.
   ========================================================================= */
import { Store } from './storage';

type AudioCtor = typeof AudioContext;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicDelay: DelayNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicOn = false;
  private musicNext = 0;
  private musicStep = 0;
  private readonly BEAT = 0.5;
  private readonly CHORDS = [[57, 60, 64], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62]];   // Am – Fmaj7 – C – G
  private readonly SCALE = [69, 72, 74, 76, 79, 81, 84];                                         // A minor pentatonic

  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC: AudioCtor | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
      const c = this.ctx;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(c.destination);
      const out = c.createGain(); out.gain.value = 0.8; out.connect(comp);
      this.sfx = c.createGain(); this.sfx.connect(out);
      this.music = c.createGain(); this.music.gain.value = 0; this.music.connect(out);
      this.musicFilter = c.createBiquadFilter();
      this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 1500; this.musicFilter.Q.value = 0.4;
      this.musicFilter.connect(this.music);
      this.musicDelay = c.createDelay(1);
      this.musicDelay.delayTime.value = 0.375;
      const fb = c.createGain(); fb.gain.value = 0.32;
      this.musicDelay.connect(fb); fb.connect(this.musicDelay); this.musicDelay.connect(this.musicFilter);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applySettings();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  applySettings() {
    if (!this.ctx || !this.sfx || !this.music) return;
    const s = Store.data.settings, t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(s.sound ? 1 : 0, t, 0.02);
    this.music.gain.setTargetAtTime(s.music ? 0.34 : 0, t, 0.5);
    if (s.music && !this.musicOn) { this.musicOn = true; this.musicNext = t + 0.1; this.musicStep = 0; }
    else if (!s.music) this.musicOn = false;
  }

  private ready() { return !!this.ctx && this.ctx.state === 'running' && Store.data.settings.sound; }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo = 0, delay = 0) {
    if (!this.ready()) return;
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx!);
    o.start(t); o.stop(t + dur + 0.03);
  }

  private noise(dur: number, gain: number, f0: number, f1: number, delay = 0) {
    if (!this.ready() || !this.noiseBuf) return;
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx!);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /* ---- Sound effects ---- */
  eat(combo: number) {
    const f = 620 * Math.pow(2, (Math.min(combo, 12) - 1) * 2 / 12);   // +2 semitones per combo step
    this.tone(f, 0.11, 'triangle', 0.24, f * 1.5);
    this.tone(f * 2, 0.07, 'sine', 0.07, 0, 0.025);
  }
  golden() { [0, 4, 7, 12].forEach((s, i) => this.tone(784 * Math.pow(2, s / 12), 0.16, 'triangle', 0.17, 0, i * 0.05)); }
  powerUp() { [0, 7, 12, 16, 19].forEach((s, i) => this.tone(659 * Math.pow(2, s / 12), 0.3, 'sine', 0.14, 0, i * 0.045)); }
  powerDown() { this.tone(700, 0.22, 'sine', 0.08, 420); }
  levelUp() { [0, 4, 7, 12].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.14, 'square', 0.06, 0, i * 0.07)); }
  turn() { this.tone(1700, 0.02, 'sine', 0.025); }
  thud() { this.tone(140, 0.18, 'sine', 0.2, 70); }
  tap() { this.tone(880, 0.045, 'sine', 0.07, 1180); }
  count(go: boolean) { if (go) this.tone(1046, 0.32, 'triangle', 0.2); else this.tone(523, 0.12, 'triangle', 0.15); }
  death() {
    this.tone(320, 0.75, 'sawtooth', 0.15, 50);
    this.tone(160, 0.5, 'square', 0.05, 45, 0.03);
    this.noise(0.5, 0.22, 3200, 160);
  }
  newBest() { [0, 4, 7, 12, 16].forEach((s, i) => this.tone(587 * Math.pow(2, s / 12), 0.28, 'triangle', 0.15, 0, i * 0.08)); }

  /* ---- Generative ambient music (lookahead scheduler, called every frame) ---- */
  tickMusic() {
    if (!this.musicOn || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (this.musicNext < c.currentTime) this.musicNext = c.currentTime + 0.05;
    while (this.musicNext < c.currentTime + 0.6) {
      this.scheduleBeat(this.musicNext, this.musicStep);
      this.musicStep++;
      this.musicNext += this.BEAT;
    }
  }
  private midi(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
  private scheduleBeat(t: number, step: number) {
    const c = this.ctx!;
    if (step % 8 === 0) {                                     // new chord every 4 s
      const chord = this.CHORDS[(step / 8) % this.CHORDS.length];
      for (let i = 0; i < chord.length; i++) {
        for (let det = -1; det <= 1; det += 2) {
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'triangle';
          o.frequency.value = this.midi(chord[i]);
          o.detune.value = det * 7;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.035, t + 1.4);
          g.gain.linearRampToValueAtTime(0.03, t + 3.4);
          g.gain.linearRampToValueAtTime(0.0001, t + 4.8);
          o.connect(g); g.connect(this.musicFilter!);
          o.start(t); o.stop(t + 4.9);
        }
      }
    }
    if (Math.random() < 0.36) {                               // sparse plucks with echo
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = this.midi(this.SCALE[(Math.random() * this.SCALE.length) | 0]);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(this.musicFilter!); g.connect(this.musicDelay!);
      o.start(t); o.stop(t + 1);
    }
  }
}

export const Sound = new SoundEngine();

/* Haptics: feature-detected, toggleable, only after a user gesture */
export const Haptics = {
  get supported() { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; },
  fire(pattern: number | number[]) {
    if (!this.supported || !Store.data.settings.haptics) return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  },
};
