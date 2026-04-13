const STORAGE_KEY = 'eco_sound_on';
const BG_MUSIC_URL = '/sounds/bg-music.mp3';
const BUCKET_COLLECT_URL = '/sounds/bucket-collect.mp3';
const FARM_WATERING_URL = '/sounds/farm-watering.mp3';
const BG_VOLUME = 0.35;
const CROSSFADE_SEC = 3;

class SoundManager {
  private ctx: AudioContext | null = null;
  private _enabled: boolean;
  private listeners = new Set<() => void>();

  private bgAudioA: HTMLAudioElement | null = null;
  private bgAudioB: HTMLAudioElement | null = null;
  private bgFadeTimer: number | null = null;
  private bgStarted = false;

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
      this.resumeBackground();
    } else {
      this.pauseBackground();
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

  // ── Background music: seamless loop with crossfade ──

  initBackground() {
    if (!this._enabled) return;

    if (!this.bgAudioA) {
      this.bgAudioA = this.createBgAudio();
      this.bgAudioB = this.createBgAudio();
    }

    if (this.bgStarted) return;

    this.bgAudioA.volume = BG_VOLUME;
    this.bgAudioA.play()
      .then(() => {
        this.bgStarted = true;
        this.scheduleCrossfade(this.bgAudioA!, this.bgAudioB!);
      })
      .catch(() => {});
  }

  private createBgAudio(): HTMLAudioElement {
    const audio = new Audio(BG_MUSIC_URL);
    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = 0;
    return audio;
  }

  private scheduleCrossfade(current: HTMLAudioElement, next: HTMLAudioElement) {
    const checkAndFade = () => {
      if (!this.bgStarted) return;
      if (!current.duration || current.paused) {
        this.bgFadeTimer = window.setTimeout(checkAndFade, 500);
        return;
      }

      const timeLeft = current.duration - current.currentTime;

      if (timeLeft <= CROSSFADE_SEC && timeLeft > 0) {
        next.currentTime = 0;
        next.volume = 0;
        next.play().catch(() => {});

        const steps = 30;
        const stepMs = (CROSSFADE_SEC * 1000) / steps;
        let step = 0;

        const fadeInterval = window.setInterval(() => {
          step++;
          const progress = step / steps;
          current.volume = Math.max(0, BG_VOLUME * (1 - progress));
          next.volume = BG_VOLUME * progress;

          if (step >= steps) {
            window.clearInterval(fadeInterval);
            current.pause();
            current.currentTime = 0;
            this.scheduleCrossfade(next, current);
          }
        }, stepMs);
        return;
      }

      const waitMs = Math.max(100, (timeLeft - CROSSFADE_SEC - 0.5) * 1000);
      this.bgFadeTimer = window.setTimeout(checkAndFade, waitMs);
    };

    this.bgFadeTimer = window.setTimeout(checkAndFade, 1000);
  }

  pauseBackground() {
    if (this.bgFadeTimer) {
      window.clearTimeout(this.bgFadeTimer);
      this.bgFadeTimer = null;
    }
    if (this.bgAudioA && !this.bgAudioA.paused) {
      this.bgAudioA.pause();
    }
    if (this.bgAudioB && !this.bgAudioB.paused) {
      this.bgAudioB.pause();
    }
  }

  resumeBackground() {
    if (!this.bgStarted || !this._enabled) return;

    const active = this.bgAudioA && this.bgAudioA.currentTime > 0 && this.bgAudioA.currentTime < (this.bgAudioA.duration || Infinity)
      ? this.bgAudioA
      : this.bgAudioB;
    const other = active === this.bgAudioA ? this.bgAudioB! : this.bgAudioA!;

    if (active) {
      active.volume = BG_VOLUME;
      active.play().catch(() => {});
      this.scheduleCrossfade(active, other);
    }
  }

  // ── Watering can on crop (own farm or friend): real sample ──

  waterDrip() {
    if (!this._enabled) return;
    try {
      const audio = new Audio(FARM_WATERING_URL);
      audio.preload = 'auto';
      audio.volume = 0.9;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // ── Bucket → can: real sample (flush / pour into container) ──

  bucketCollectToCan() {
    if (!this._enabled) return;
    try {
      const audio = new Audio(BUCKET_COLLECT_URL);
      audio.preload = 'auto';
      audio.volume = 0.9;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // ── Bucket pour: heavier water pour (synthesized fallback) ──

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
