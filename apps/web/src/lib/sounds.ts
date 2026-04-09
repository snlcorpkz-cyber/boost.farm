const STORAGE_KEY = 'eco_sound_on';

class SoundManager {
  private ctx: AudioContext | null = null;
  private bgNodes: AudioNode[] = [];
  private bgTimers: number[] = [];
  private bgRunning = false;
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
    if (this._enabled) {
      this.startBackground();
    } else {
      this.stopBackground();
    }
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

  // ── Background: gentle pentatonic melody + soft pad + bird chirps ──

  initBackground() {
    if (this._enabled) this.startBackground();
  }

  private startBackground() {
    if (this.bgRunning) return;
    const ctx = this.getCtx();
    this.bgRunning = true;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    master.connect(ctx.destination);
    this.bgNodes.push(master);

    // Soft pad (warm chord)
    const padGain = ctx.createGain();
    padGain.gain.value = 0.035;
    padGain.connect(master);
    this.bgNodes.push(padGain);

    const padNotes = [130.81, 196.00, 261.63]; // C3, G3, C4
    padNotes.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15 + Math.random() * 0.1;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 1.5;
      lfo.connect(lfoG).connect(osc.detune);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 500;
      filt.Q.value = 0.7;
      osc.connect(filt).connect(padGain);
      osc.start();
      lfo.start();
      this.bgNodes.push(osc, lfo, filt);
    });

    // Melody: pentatonic notes played gently in a loop
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.00]; // C5 D5 E5 G5 A5
    const melodyGain = ctx.createGain();
    melodyGain.gain.value = 0.07;
    const melodyReverb = ctx.createBiquadFilter();
    melodyReverb.type = 'lowpass';
    melodyReverb.frequency.value = 2000;
    melodyGain.connect(melodyReverb).connect(master);
    this.bgNodes.push(melodyGain, melodyReverb);

    const playNote = () => {
      if (!this.bgRunning) return;
      const c = this.getCtx();
      const t = c.currentTime;
      const freq = pentatonic[Math.floor(Math.random() * pentatonic.length)];
      const osc = c.createOscillator();
      osc.type = Math.random() > 0.5 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      osc.connect(g).connect(melodyGain);
      osc.start(t);
      osc.stop(t + 1.8);
      const next = 1500 + Math.random() * 2500;
      this.bgTimers.push(window.setTimeout(playNote, next));
    };
    this.bgTimers.push(window.setTimeout(playNote, 2000));

    // Bird chirps
    const chirp = () => {
      if (!this.bgRunning) return;
      const c = this.getCtx();
      const t = c.currentTime;
      const baseFreq = 2500 + Math.random() * 1500;
      for (let i = 0; i < 3; i++) {
        const osc = c.createOscillator();
        osc.type = 'sine';
        const nt = t + i * 0.08;
        osc.frequency.setValueAtTime(baseFreq + i * 200, nt);
        osc.frequency.exponentialRampToValueAtTime(baseFreq + i * 400, nt + 0.04);
        const g = c.createGain();
        g.gain.setValueAtTime(0.025, nt);
        g.gain.exponentialRampToValueAtTime(0.001, nt + 0.06);
        osc.connect(g).connect(master);
        osc.start(nt);
        osc.stop(nt + 0.06);
      }
      const next = 4000 + Math.random() * 8000;
      this.bgTimers.push(window.setTimeout(chirp, next));
    };
    this.bgTimers.push(window.setTimeout(chirp, 5000));
  }

  private stopBackground() {
    if (!this.bgRunning) return;
    this.bgRunning = false;
    this.bgTimers.forEach((t) => clearTimeout(t));
    this.bgTimers = [];
    const master = this.bgNodes[0] as GainNode | undefined;
    if (master && this.ctx) {
      master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
    }
    setTimeout(() => {
      this.bgNodes.forEach((n) => {
        try {
          if ('stop' in n && typeof (n as any).stop === 'function') (n as any).stop();
        } catch {}
        try { n.disconnect(); } catch {}
      });
      this.bgNodes = [];
    }, 900);
  }

  // ── Watering: realistic water pouring (noise + bubbles) ──

  waterDrip() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const dur = 1.2;

    // Water stream: filtered noise
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

    // Bubbles / splashes
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

    // Heavy pour: lower frequency noise
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

    // Splash at start
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

    // Bubbles
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
    // C major arpeggio up + octave
    const notes = [
      { f: 523.25, t: 0 },    // C5
      { f: 659.25, t: 0.1 },  // E5
      { f: 783.99, t: 0.2 },  // G5
      { f: 1046.5, t: 0.35 }, // C6
      { f: 1318.5, t: 0.5 },  // E6
    ];

    notes.forEach(({ f, t: dt }) => {
      // Fundamental
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

      // Harmonic for brightness
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

    // Shimmer sweep at the end
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

    // Two bright "ding" sounds, like coins
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

      // Overtone
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
