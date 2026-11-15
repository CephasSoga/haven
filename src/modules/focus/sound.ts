import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Noise = "off" | "brown" | "rain" | "white";
export const NOISES: { value: Noise; label: string }[] = [
  { value: "off", label: "Silence" },
  { value: "brown", label: "Deep" },
  { value: "rain", label: "Rain" },
  { value: "white", label: "Bright" },
];

/** Background sound is a per-device choice (not synced: the phone shouldn't start humming). */
export const useFocusSound = create<{ noise: Noise; volume: number; set: (p: Partial<{ noise: Noise; volume: number }>) => void }>()(
  persist((set) => ({ noise: "off", volume: 0.4, set }), { name: "haven:focus-sound" }),
);

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let playing: Noise = "off";

const audio = () => (ctx ??= new AudioContext());

/** A few seconds of noise, generated (no sound files), looped. */
function buffer(kind: Exclude<Noise, "off">) {
  const c = audio();
  const length = c.sampleRate * 6;
  const b = c.createBuffer(1, length, c.sampleRate);
  const data = b.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "white") data[i] = white * 0.25;
    else if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      // Pink noise (Paul Kellet's filter): soft, like steady rain.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  // Fade the loop's ends into each other so there's no click.
  const fade = Math.floor(c.sampleRate * 0.5);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + data[length - fade + i] * (1 - t);
  }
  return b;
}

/** Plays (or switches to) a background sound; "off" stops it. */
export function playNoise(kind: Noise, volume: number) {
  if (kind === playing) {
    if (gain && ctx) gain.gain.setTargetAtTime(volume * 0.6, ctx.currentTime, 0.2);
    return;
  }
  stopNoise();
  if (kind === "off") return;
  const c = audio();
  void c.resume();
  gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(volume * 0.6, c.currentTime, 0.8);
  gain.connect(c.destination);
  source = c.createBufferSource();
  source.buffer = buffer(kind);
  source.loop = true;
  source.loopStart = 0.5;
  source.connect(gain);
  source.start();
  playing = kind;
}

export function stopNoise() {
  if (source && gain && ctx) {
    const s = source;
    const g = gain;
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => {
      s.stop();
      g.disconnect();
    }, 1200);
  }
  source = null;
  gain = null;
  playing = "off";
}

/** A soft two-note bell for the end of a session or a break. */
export function chime() {
  try {
    const c = audio();
    void c.resume();
    [659.25, 987.77].forEach((freq, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const t = c.currentTime + i * 0.22;
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 1.9);
    });
  } catch {
    /* no sound available */
  }
}
