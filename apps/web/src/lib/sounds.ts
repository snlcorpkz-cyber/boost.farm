const STORAGE_KEY = 'eco_sound_on';

class SoundManager {
  private ctx: AudioContext | null = null;
  private _enabled: boolean;
  private listeners = new Set<() => void>();

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    this._enabled = stored === null ? true : stored === '1';
  }

  get enabled() {
    return this._enabled;
  }

  toggle() {
    this._enabled = !this._enabled;
    localStorage.setItem(STORAGE_KEY, this._enabled ? '1' : '0');
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── Watering: realistic water pouring (noise + bubbles) ──

  waterDrip() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const dur = 1.2;

    const noise = ctx.createBufferSource();
    noise.buffer = this.makeNoise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3000, now);
    bp.frequency.linearRampToValueAtTime(1500, now + dur);
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.18, now + 0.05);
    ng.gain.setValueAtTime(0.15, now + dur * 0.3);
    ng.gain.linearRampToValueAtTime(0.08, now + dur * 0.8);
    ng.gain.linearRampToValueAtTime(0, now + dur);
    noise.connect(bp).connect(hp).connect(ng).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);

    for (let i = 0; i < 12; i++) {
      const t = now + 0.05 + Math.random() * (dur - 0.2);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = 300 + Math.random() * 600;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06 + Math.random() * 0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
    }
  }

  // ── Bucket pour: heavier water pour ──

  bucketPour() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const dur = 0.9;

    const noise = ctx.createBufferSource();
    noise.buffer = this.makeNoise(ctx, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200, now);
    bp.frequency.exponentialRampToValueAtTime(600, now + dur);
    bp.Q.value = 1.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.25, now + 0.06);
    ng.gain.setValueAtTime(0.22, now + dur * 0.4);
    ng.gain.linearRampToValueAtTime(0.05, now + dur * 0.85);
    ng.gain.linearRampToValueAtTime(0, now + dur);
    noise.connect(bp).connect(lp).connect(ng).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);

    const splash = ctx.createBufferSource();
    splash.buffer = this.makeNoise(ctx, 0.15);
    const sf = ctx.createBiquadFilter();
    sf.type = 'highpass';
    sf.frequency.value = 2000;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.12, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    splash.connect(sf).connect(sg).connect(ctx.destination);
    splash.start(now);
    splash.stop(now + 0.15);

    for (let i = 0; i < 8; i++) {
      const t = now + 0.1 + Math.random() * 0.5;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = 200 + Math.random() * 400;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.3, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    }
  }

  // ── Celebration: bright fanfare with harmonics ──

  celebration() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const notes = [
      { f: 523.25, t: 0 },
      { f: 659.25, t: 0.1 },
      { f: 783.99, t: 0.2 },
      { f: 1046.5, t: 0.35 },
      { f: 1318.5, t: 0.5 },
    ];

    notes.forEach(({ f, t: dt }) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now + dt);
      g.gain.linearRampToValueAtTime(0.18, now + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.8);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + dt);
      osc.stop(now + dt + 0.8);

      const h = ctx.createOscillator();
      h.type = 'sine';
      h.frequency.value = f * 2;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0, now + dt);
      hg.gain.linearRampToValueAtTime(0.06, now + dt + 0.02);
      hg.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.4);
      h.connect(hg).connect(ctx.destination);
      h.start(now + dt);
      h.stop(now + dt + 0.4);
    });

    const shNoise = ctx.createBufferSource();
    shNoise.buffer = this.makeNoise(ctx, 0.6);
    const shF = ctx.createBiquadFilter();
    shF.type = 'bandpass';
    shF.frequency.setValueAtTime(4000, now + 0.5);
    shF.frequency.linearRampToValueAtTime(8000, now + 1.1);
    shF.Q.value = 2;
    const shG = ctx.createGain();
    shG.gain.setValueAtTime(0.04, now + 0.5);
    shG.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    shNoise.connect(shF).connect(shG).connect(ctx.destination);
    shNoise.start(now + 0.5);
    shNoise.stop(now + 1.1);
  }

  // ── Reward chime: bright coin-like sound ──

  rewardChime() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    [0, 0.15].forEach((dt, i) => {
      const freq = i === 0 ? 1200 : 1800;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + dt);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, now + dt);
      g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.5);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + dt);
      osc.stop(now + dt + 0.5);

      const h = ctx.createOscillator();
      h.type = 'sine';
      h.frequency.setValueAtTime(freq * 2.756, now + dt);
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.08, now + dt);
      hg.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.3);
      h.connect(hg).connect(ctx.destination);
      h.start(now + dt);
      h.stop(now + dt + 0.3);
    });
  }

  // ── Button tap ──

  buttonTap() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.04);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }
}

export const sounds = new SoundManager();
