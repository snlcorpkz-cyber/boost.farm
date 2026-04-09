const STORAGE_KEY = 'eco_sound_on';

class SoundManager {
  private ctx: AudioContext | null = null;
  private bgGain: GainNode | null = null;
  private bgOscillators: OscillatorNode[] = [];
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

  // ── Ambient background music (generated) ──

  initBackground() {
    if (this._enabled) {
      this.startBackground();
    }
  }

  private startBackground() {
    if (this.bgRunning) return;
    const ctx = this.getCtx();
    this.bgRunning = true;

    this.bgGain = ctx.createGain();
    this.bgGain.gain.value = 0;
    this.bgGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);
    this.bgGain.connect(ctx.destination);

    const chords = [
      [261.63, 329.63, 392.00], // C major
      [293.66, 369.99, 440.00], // D major
      [246.94, 311.13, 369.99], // B minor-ish
      [220.00, 277.18, 329.63], // A minor
    ];

    const chord = chords[Math.floor(Math.random() * chords.length)];

    chord.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * 0.5;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + Math.random() * 0.04;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 2;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start();

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      filter.Q.value = 1;

      osc.connect(filter).connect(this.bgGain!);
      osc.start();
      this.bgOscillators.push(osc, lfo);
    });

    const padOsc = ctx.createOscillator();
    padOsc.type = 'triangle';
    padOsc.frequency.value = chord[0] * 0.25;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 200;
    padOsc.connect(padFilter).connect(this.bgGain!);
    padOsc.start();
    this.bgOscillators.push(padOsc);
  }

  private stopBackground() {
    if (!this.bgRunning) return;
    this.bgRunning = false;
    const ctx = this.ctx;
    if (ctx && this.bgGain) {
      this.bgGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    }
    setTimeout(() => {
      this.bgOscillators.forEach((osc) => {
        try { osc.stop(); } catch {}
      });
      this.bgOscillators = [];
      if (this.bgGain) {
        this.bgGain.disconnect();
        this.bgGain = null;
      }
    }, 600);
  }

  // ── SFX: Water drip (watering the plant) ──

  waterDrip() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.07;
      const freq = 520 - i * 35 + Math.random() * 20;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.1);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  // ── SFX: Bucket pour (collecting water from bucket into can) ──

  bucketPour() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const duration = 0.7;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + duration);
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.setValueAtTime(0.18, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.06, now + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + duration);
  }

  // ── SFX: Celebration (stage change) ──

  celebration() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.13;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });

    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(2093, now + 0.5);
    shimmerGain.gain.setValueAtTime(0.08, now + 0.5);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    shimmer.connect(shimmerGain).connect(ctx.destination);
    shimmer.start(now + 0.5);
    shimmer.stop(now + 1.2);
  }

  // ── SFX: Reward chime (daily challenge, gifts) ──

  rewardChime() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    [880, 1174.66, 1318.51].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.1;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  // ── SFX: Button tap ──

  buttonTap() {
    if (!this._enabled) return;
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }
}

export const sounds = new SoundManager();
