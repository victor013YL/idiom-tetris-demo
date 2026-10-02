// tetris — sound.js
// ============================================================================
// AUDIO LAYER. Two cleanly separated systems:
//
//   1. SFX — procedural blips generated at runtime via Web Audio API
//      oscillators. No samples shipped. Cheap, tiny, instantly reactive.
//
//   2. MUSIC — a single bundled CC0 chiptune MP3 played via a plain
//      <audio> element, looped forever. Until v1.1.x we generated the
//      Korobeiniki theme procedurally with two Web Audio voices, but a
//      surprising number of browsers throttled the lookahead scheduler
//      (especially under autoplay restrictions on iOS/Safari and Chrome's
//      tab-throttling), so nothing audible came out. A real audio file
//      sidesteps all that — modern browsers handle <audio> reliably the
//      moment a user gesture has unlocked playback.
//
// The MP3 we ship — assets/music.mp3 — is "Happy Adventure (Loop)" by
// Bart Kelsey (https://opengameart.org/content/happy-adventure-loop),
// released under CC0 (Public Domain). 8-bit / chiptune vibe, ~620 KB,
// loops seamlessly.
// ============================================================================

// Original synthesized stone cracks: short noisy impacts + low resonances.
export const STONE_LEVELS = Object.freeze([
  null,
  Object.freeze({ duration: 0.28, gain: 0.16, layers: 1, bass: 180 }),
  Object.freeze({ duration: 0.39, gain: 0.22, layers: 2, bass: 145 }),
  Object.freeze({ duration: 0.52, gain: 0.28, layers: 3, bass: 110 }),
  Object.freeze({ duration: 0.65, gain: 0.34, layers: 4, bass: 85 }),
]);

export class Sound {
  constructor() {
    this.ctx = null;       // Web Audio context — lazy (see ensure())
    this.enabled = true;   // SFX on/off
    this.music = false;    // music on/off
    this.audio = null;     // HTMLAudioElement for background music
    this.musicVolume = 0.40;
    this.sfxVolume = 0.75;
    this.rotateVoice = null;
    this.clearVoice = null;
    this.stoneBuffers = new Map();
  }

  setVolume(channel, value) {
    if (!['musicVolume', 'sfxVolume'].includes(channel) || !Number.isFinite(value)) return;
    this[channel] = Math.min(1, Math.max(0, value));
    if (channel === 'musicVolume' && this.audio) this.audio.volume = this.musicVolume;
    if (channel === 'sfxVolume') { this.stopRotate(); this.stopClear(); }
  }

  // CRITICAL on iOS / Safari: AudioContext is created in 'suspended' state
  // and MUST be unlocked by a user gesture (tap, click, keydown handler) for
  // any sound to play. We create the context lazily on the first call from
  // a user-initiated handler (e.g. clicking "Press Start"). Same gesture
  // also lets the <audio> element call .play() without an autoplay rejection.
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // ------- SFX primitive -------
  // One-shot oscillator with exponential gain decay. Combine with setTimeout
  // to chain blips into arpeggios.
  blip(freq = 440, duration = 0.06, type = 'square', gain = 0.06) {
    if (!this.enabled || this.sfxVolume === 0) return;
    this.ensure();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain * this.sfxVolume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + duration);
  }

  // Per-action SFX. Pitches chosen by ear.
  move()   { this.blip(220, 0.03, 'square', 0.04); }
  rotate() {
    if (!this.enabled || this.sfxVolume === 0) return;
    this.ensure();
    // Never queue delayed sounds while an autoplay restriction is in force.
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    let voice = this.rotateVoice;
    if (voice && now >= voice.end) { this.stopRotate(); voice = null; }
    if (!voice) {
      const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
      oscillator.type = 'square';
      gain.gain.value = 0;
      oscillator.connect(gain).connect(this.ctx.destination);
      voice = { oscillator, gain, end: 0 };
      this.rotateVoice = voice;
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect();
        if (this.rotateVoice === voice) this.rotateVoice = null;
      };
      oscillator.start(now);
    }
    // Reuse the same oscillator/envelope: rapid input cannot stack voices.
    const volume = voice.gain.gain;
    volume.cancelAndHoldAtTime(now);
    volume.linearRampToValueAtTime(0.025 * this.sfxVolume, now + 0.003);
    volume.exponentialRampToValueAtTime(0.0001, now + 0.06);
    voice.oscillator.frequency.cancelScheduledValues(now);
    voice.oscillator.frequency.setValueAtTime(820, now);
    voice.oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    voice.end = now + 0.065;
    voice.oscillator.stop(voice.end);
  }

  stopRotate() {
    const voice = this.rotateVoice;
    if (!voice) return;
    this.rotateVoice = null;
    voice.oscillator.stop();
    voice.oscillator.disconnect();
    voice.gain.disconnect();
  }
  lock()   { this.blip(140, 0.07, 'sawtooth', 0.05); }

  clear(n = 1) {
    if (!this.enabled || this.sfxVolume === 0 || !Number.isInteger(n) || n < 1 || n > 4) return;
    this.ensure();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const spec = STONE_LEVELS[n];
    if (!this.stoneBuffers.has(n)) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, Math.ceil(rate * spec.duration), rate);
      const data = buffer.getChannelData(0);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate, noise = Math.random() * 2 - 1;
        low += 0.12 * (noise - low);
        let value = 0;
        for (let layer = 0; layer < spec.layers; layer++) {
          const age = t - layer * 0.045;
          if (age < 0) continue;
          const attack = Math.min(1, age / 0.002);
          const crack = (noise * 0.42 + low * 1.4) * Math.exp(-age * 24);
          const body = Math.sin(2 * Math.PI * spec.bass * age) * Math.exp(-age * 18) * (0.18 + n * 0.055);
          const grit = low * Math.pow(Math.max(0, 1 - t / spec.duration), 2) * 0.6;
          value += attack * (crack + body + grit) / Math.sqrt(spec.layers);
        }
        // Smooth tail and bounded peak, no delayed timers or extra voices.
        data[i] = Math.tanh(value) * Math.min(1, (spec.duration - t) / 0.025);
      }
      this.stoneBuffers.set(n, buffer);
    }
    this.stopClear();
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = this.stoneBuffers.get(n);
    gain.gain.value = spec.gain * this.sfxVolume;
    source.connect(gain).connect(this.ctx.destination);
    const voice = { source, gain, level: n };
    this.clearVoice = voice;
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      if (this.clearVoice === voice) this.clearVoice = null;
    };
    source.start();
  }

  stopClear() {
    const voice = this.clearVoice;
    if (!voice) return;
    this.clearVoice = null;
    voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect();
  }

  drop() { this.blip(110, 0.1, 'square', 0.07); }
  hold() { this.blip(520, 0.05, 'sine', 0.05); }

  over() {
    [440, 330, 247, 165].forEach((f, i) => setTimeout(() => this.blip(f, 0.18, 'triangle', 0.08), i * 120));
  }

  // ------- MUSIC -------
  // Lazily build the <audio> element. We create it on first toggle, not on
  // construction, so that browsers that block AudioContext / autoplay don't
  // pre-create resources we may never use.
  ensureAudio() {
    if (this.audio) return this.audio;
    const a = new Audio('assets/music.mp3');
    a.loop = true;
    a.preload = 'auto';
    a.volume = this.musicVolume;
    // Some browsers (Safari) emit an 'error' event when the source can't
    // load. We swallow it silently — the game continues without music.
    a.addEventListener('error', () => { /* music unavailable; game continues */ });
    this.audio = a;
    return a;
  }

  // setMusic(true)  → play (idempotent, unlocked by the caller's user gesture)
  // setMusic(false) → pause
  setMusic(on) {
    this.music = !!on;
    const a = this.ensureAudio();
    if (this.music) {
      // play() returns a Promise that rejects if autoplay is blocked. We
      // catch silently — the player just has to toggle music again from a
      // gesture. In practice this only happens before the first click.
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      try { a.pause(); } catch { /* no-op */ }
    }
  }
}
