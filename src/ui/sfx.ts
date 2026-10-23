/**
 * Звуки боя синтезируются на лету (Web Audio): в игре нет ни одного звукового файла, это ~0 КБ.
 * Контекст создаётся только после первого касания, как требуют браузеры.
 */
const KEY = 'gos_sound';

let ctx: AudioContext | null = null;
let enabled = true;
let paused = false;

try {
  enabled = window.localStorage.getItem(KEY) !== 'off';
} catch {
  /* хранилище недоступно: звук включён по умолчанию */
}

function audio(): AudioContext | null {
  if (!enabled || paused) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(type: OscillatorType, from: number, to: number, dur: number, gain: number, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, freq: number, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  get enabled(): boolean {
    return enabled;
  },
  setEnabled(on: boolean): void {
    enabled = on;
    try {
      window.localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* не критично */
    }
  },
  setPaused(p: boolean): void {
    paused = p;
    if (p && ctx) void ctx.suspend();
  },
  hit(strong: boolean): void {
    noise(0.12, strong ? 0.5 : 0.3, 1800);
    tone('sine', strong ? 170 : 130, 40, 0.16, strong ? 0.6 : 0.4);
  },
  perfect(): void {
    tone('sine', 880, 880, 0.35, 0.16);
    tone('sine', 1320, 1320, 0.4, 0.12, 0.05);
  },
  block(perfect: boolean): void {
    tone('square', 220, 160, 0.09, 0.18);
    noise(0.08, 0.3, 3000);
    if (perfect) tone('sine', 1040, 1040, 0.3, 0.14, 0.04);
  },
  heal(): void {
    [520, 660, 780].forEach((f, i) => tone('sine', f, f, 0.28, 0.12, i * 0.08));
  },
  fire(): void {
    noise(0.5, 0.35, 700);
    tone('sawtooth', 300, 90, 0.45, 0.12);
  },
  die(): void {
    tone('sawtooth', 220, 50, 0.45, 0.22);
  },
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.4, 0.15, i * 0.12));
  },
  lose(): void {
    [392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.9, 0.5, 0.15, i * 0.2));
  },
  tick(): void {
    tone('sine', 1500, 1500, 0.04, 0.05);
  },
};
