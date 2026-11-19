import { create } from "zustand";
import { persist } from "zustand/middleware";

/*
 * Focus sounds, made on the spot with Web Audio (no sound files to download): rain with its drops, rolling
 * thunder, waves that come and go, a babbling stream, gusts of wind, a crackling fire, birds, crickets, a slow
 * ambient drift, binaural beats and the usual noises. Any of them can be layered into a mix, each with its own
 * level, and your own audio files can join in.
 */

export type SoundId =
  | "rain" | "thunder" | "waves" | "stream" | "wind" | "fire" | "birds" | "crickets"
  | "drift" | "binaural" | "white" | "pink" | "brown" | "plane" | "clock";

export type SoundGroup = "nature" | "music" | "steady";

export const SOUNDS: { id: SoundId; label: string; group: SoundGroup; hint?: string }[] = [
  { id: "rain", label: "Rain", group: "nature" },
  { id: "thunder", label: "Thunder", group: "nature" },
  { id: "waves", label: "Waves", group: "nature" },
  { id: "stream", label: "Stream", group: "nature" },
  { id: "wind", label: "Wind", group: "nature" },
  { id: "fire", label: "Fireplace", group: "nature" },
  { id: "birds", label: "Birds", group: "nature" },
  { id: "crickets", label: "Crickets", group: "nature" },
  { id: "drift", label: "Ambient", group: "music", hint: "Slow, soft notes that never repeat" },
  { id: "binaural", label: "Binaural beat", group: "music", hint: "Use headphones" },
  { id: "brown", label: "Deep noise", group: "steady" },
  { id: "pink", label: "Soft noise", group: "steady" },
  { id: "white", label: "Bright noise", group: "steady" },
  { id: "plane", label: "Plane cabin", group: "steady" },
  { id: "clock", label: "Ticking clock", group: "steady" },
];

export const GROUP_LABELS: Record<SoundGroup, string> = { nature: "Nature", music: "Music", steady: "Steady" };

/** A mix: what plays, and how loud (0–1). Your own files are "own:<id>". */
export type Mix = Record<string, number>;

export const PRESETS: { id: string; label: string; mix: Mix }[] = [
  { id: "rainy", label: "Rainy day", mix: { rain: 0.7, brown: 0.25 } },
  { id: "storm", label: "Storm", mix: { rain: 0.75, thunder: 0.6, wind: 0.35 } },
  { id: "seaside", label: "Seaside", mix: { waves: 0.75, wind: 0.25 } },
  { id: "fireside", label: "Fireside", mix: { fire: 0.75, rain: 0.3 } },
  { id: "forest", label: "Forest", mix: { birds: 0.55, stream: 0.4, wind: 0.2 } },
  { id: "night", label: "Summer night", mix: { crickets: 0.55, wind: 0.2 } },
  { id: "deep", label: "Deep work", mix: { brown: 0.6, drift: 0.35 } },
  { id: "flow", label: "Flow", mix: { drift: 0.6, binaural: 0.35 } },
];

export type Bell = "bell" | "bowl" | "chimes" | "wood" | "none";
export const BELLS: { value: Bell; label: string }[] = [
  { value: "bell", label: "Bell" },
  { value: "bowl", label: "Singing bowl" },
  { value: "chimes", label: "Chimes" },
  { value: "wood", label: "Wood" },
  { value: "none", label: "No sound" },
];

export type Beat = 10 | 16 | 40;
export const BEATS: { value: Beat; label: string }[] = [
  { value: 10, label: "Calm · 10 Hz" },
  { value: 16, label: "Alert · 16 Hz" },
  { value: 40, label: "Sharp · 40 Hz" },
];

export type OwnSound = { id: string; name: string };

type SoundPrefs = { mix: Mix; volume: number; beat: Beat; bell: Bell; own: OwnSound[] };

/** Background sound is a per-device choice (not synced: the phone shouldn't start humming). */
export const useFocusSound = create<SoundPrefs & { set: (p: Partial<SoundPrefs>) => void; setLayer: (id: string, level: number | null) => void }>()(
  persist(
    (set) => ({
      mix: {},
      volume: 0.6,
      beat: 10,
      bell: "bell",
      own: [],
      set,
      setLayer: (id, level) =>
        set((s) => {
          const mix = { ...s.mix };
          if (level === null) delete mix[id];
          else mix[id] = level;
          return { mix };
        }),
    }),
    {
      name: "haven:focus-sound",
      version: 1,
      migrate: (old, version) => {
        const o = (old ?? {}) as { noise?: string; volume?: number };
        if (version >= 1) return old as SoundPrefs;
        const mix: Mix = o.noise && o.noise !== "off" ? { [o.noise]: 0.6 } : {};
        return { mix, volume: o.volume ?? 0.6, beat: 10, bell: "bell", own: [] } as SoundPrefs;
      },
    },
  ),
);

/** "Listen" on the set-up screen plays the mix before a session starts. */
export const usePreview = create<{ on: boolean; set: (on: boolean) => void }>()((set) => ({ on: false, set: (on) => set({ on }) }));

export const sameMix = (a: Mix, b: Mix) => {
  const keys = (m: Mix) => Object.keys(m).filter((k) => m[k] > 0).sort();
  const ka = keys(a);
  const kb = keys(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Math.abs(a[k] - b[k]) < 0.01);
};

/* ---------- Building blocks ---------- */

type Ctx = BaseAudioContext;
/** What a playing layer needs undone when it stops. */
type Life = { stops: (() => void)[]; sources: AudioScheduledSourceNode[] };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const noiseCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();
const LOOP_S = 8;

/** Eight seconds of noise whose ends fade into each other, so it loops without a click. All have the same loudness. */
function noiseBuffer(c: Ctx, kind: "white" | "pink" | "brown") {
  let cache = noiseCache.get(c);
  if (!cache) noiseCache.set(c, (cache = new Map()));
  const hit = cache.get(kind);
  if (hit) return hit;
  const fade = Math.floor(c.sampleRate * 0.5);
  const length = c.sampleRate * LOOP_S;
  const raw = new Float32Array(length + fade);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "white") raw[i] = white;
    else if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last;
    } else {
      // Pink noise (Paul Kellet's filter)
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    }
  }
  const b = c.createBuffer(1, length, c.sampleRate);
  const data = b.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = raw[i];
  // The extra half second after the end fades in over the start.
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + raw[length + i] * (1 - t);
  }
  let sum = 0;
  for (let i = 0; i < length; i++) sum += data[i] * data[i];
  const scale = 0.2 / Math.sqrt(sum / length);
  for (let i = 0; i < length; i++) data[i] *= scale;
  cache.set(kind, b);
  return b;
}

function gain(c: Ctx, value: number, to?: AudioNode) {
  const g = c.createGain();
  g.gain.value = value;
  if (to) g.connect(to);
  return g;
}

function filter(c: Ctx, type: BiquadFilterType, frequency: number, q = 0.7) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function panned(c: Ctx, pan: number, to: AudioNode) {
  const p = c.createStereoPanner();
  p.pan.value = pan;
  p.connect(to);
  return p;
}

/** Looping noise into `to`, started at a random place (two of them make a wide, stereo sound). */
function loop(c: Ctx, life: Life, kind: "white" | "pink" | "brown", to: AudioNode, pan = 0) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, kind);
  s.loop = true;
  s.connect(pan ? panned(c, pan, to) : to);
  s.start(c.currentTime, rand(0, LOOP_S - 0.5));
  life.sources.push(s);
  return s;
}

/**
 * Fires `fire(time)` again and again, `gap` seconds apart, scheduled a little ahead of the clock so it never
 * stutters. Rendered offline (for measuring), everything is scheduled at once.
 */
function events(c: Ctx, life: Life, first: number, gap: () => number, fire: (t: number) => void) {
  let next = c.currentTime + first;
  const run = (until: number) => {
    // After a stall (the computer slept), carry on from now rather than playing everything missed at once.
    if (next < c.currentTime) next = c.currentTime + 0.05;
    while (next < until) {
      fire(next);
      next += Math.max(0.002, gap());
    }
  };
  if (typeof OfflineAudioContext !== "undefined" && c instanceof OfflineAudioContext) return run(c.length / c.sampleRate);
  run(c.currentTime + 1.5);
  const t = setInterval(() => run(c.currentTime + 1.5), 400);
  life.stops.push(() => clearInterval(t));
}

const between = (a: number, b: number) => () => rand(a, b);

/** Moves a setting to a new random value now and then, smoothly: what keeps a sound alive. */
function wander(c: Ctx, life: Life, param: AudioParam, min: number, max: number, gapS: [number, number], smooth: number) {
  param.value = (min + max) / 2;
  events(c, life, rand(0, gapS[0]), between(...gapS), (t) => param.setTargetAtTime(rand(min, max), t, smooth));
}

/** A short burst of filtered noise: a raindrop, a crackle, a click. */
function burst(c: Ctx, to: AudioNode, t: number, o: { freq: number; q: number; peak: number; decay: number; pan?: number }) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, "white");
  const f = filter(c, "bandpass", o.freq, o.q);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + 0.0008);
  g.gain.setTargetAtTime(0, t + 0.0008, o.decay);
  s.connect(f).connect(g).connect(o.pan ? panned(c, o.pan, to) : to);
  s.start(t, rand(0, LOOP_S - 1), o.decay * 7 + 0.01);
}

/** A tone with a shape: rises in `attack`, fades out by `end`. */
function tone(c: Ctx, to: AudioNode, t: number, o: { freq: number; type?: OscillatorType; peak: number; attack: number; end: number; glideTo?: number }) {
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + o.end);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + o.attack);
  g.gain.setTargetAtTime(0, t + o.attack, Math.max(0.005, (o.end - o.attack) / 4));
  osc.connect(g).connect(to);
  osc.start(t);
  osc.stop(t + o.end + 0.2);
  return osc;
}

/** A room for sounds to ring in. */
function reverb(c: Ctx, seconds: number, to: AudioNode) {
  const v = c.createConvolver();
  const len = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  v.buffer = b;
  v.connect(to);
  return v;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const DROPS_S = 13;
const dropCache = new WeakMap<Ctx, AudioBuffer>();

/**
 * Raindrops: thousands of tiny ringing clicks. Made sample by sample, once (a separate sound for each drop
 * would keep the computer busy for nothing).
 */
function dropsBuffer(c: Ctx) {
  const hit = dropCache.get(c);
  if (hit) return hit;
  const sr = c.sampleRate;
  const length = sr * DROPS_S;
  const b = c.createBuffer(1, length, sr);
  const d = b.getChannelData(0);
  const drop = (at: number, freq: number, q: number, peak: number, decay: number) => {
    // A band-pass filter (as Web Audio's) over noise that dies away quickly.
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const n = Math.floor(decay * 7 * sr);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * peak * Math.exp(-i / (decay * sr));
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      d[(at + i) % length] += y;
    }
  };
  for (let t = 0; t < DROPS_S; t += rand(0.004, 0.03)) drop(Math.floor(t * sr), rand(1800, 7000), rand(0.8, 3), rand(0.15, 0.9) ** 2, rand(0.003, 0.012));
  // Heavier ones dripping close by.
  for (let t = rand(0, 1); t < DROPS_S; t += rand(0.25, 1.4)) drop(Math.floor(t * sr), rand(700, 1800), rand(2, 6), rand(0.4, 1), rand(0.008, 0.025));
  dropCache.set(c, b);
  return b;
}

/* ---------- The sounds ---------- */

type Maker = (c: Ctx, out: AudioNode, life: Life, o: { beat: Beat }) => void;

export const MAKERS: Record<SoundId, Maker> = {
  rain(c, out, life) {
    // The steady wash of rain…
    const hp = filter(c, "highpass", 400);
    const lp = filter(c, "lowpass", 6000, 0.5);
    const bed = gain(c, 0.7, out);
    hp.connect(lp).connect(bed);
    loop(c, life, "pink", hp, -0.5);
    loop(c, life, "pink", hp, 0.5);
    wander(c, life, bed.gain, 0.55, 0.9, [2, 6], 1.5);
    wander(c, life, lp.frequency, 4000, 8000, [3, 8], 2);
    // …and the drops all around: made once, played as two loops of different lengths so the pattern never repeats.
    const drops = dropsBuffer(c);
    [[-0.7, 1], [0.7, 0.913]].forEach(([pan, rate]) => {
      const s = c.createBufferSource();
      s.buffer = drops;
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(panned(c, pan, out));
      s.start(c.currentTime, rand(0, DROPS_S));
      life.sources.push(s);
    });
  },

  thunder(c, out, life) {
    events(c, life, rand(3, 9), between(14, 40), (t) => {
      const far = Math.random() < 0.55;
      const len = rand(5, 10);
      const peak = far ? rand(0.5, 0.9) : rand(1, 1.6);
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c, "brown");
      s.loop = true;
      const lp = filter(c, "lowpass", far ? 320 : 1000, 0.6);
      lp.frequency.setValueAtTime(far ? 320 : 1000, t);
      lp.frequency.exponentialRampToValueAtTime(far ? 90 : 150, t + len * 0.6);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + (far ? rand(0.6, 1.6) : rand(0.08, 0.4)));
      // It rolls on, swelling and fading.
      let level = peak;
      for (let at = t + 1.2; at < t + len; at += rand(0.7, 1.8)) {
        level *= rand(0.55, 0.9);
        g.gain.setTargetAtTime(level * rand(0.7, 1.3), at, rand(0.25, 0.8));
      }
      g.gain.setTargetAtTime(0, t + len, 1.2);
      s.connect(lp).connect(g).connect(panned(c, rand(-0.5, 0.5), out));
      s.start(t, rand(0, LOOP_S - 1));
      s.stop(t + len + 6);
    });
  },

  waves(c, out, life) {
    const bedLp = filter(c, "lowpass", 260);
    bedLp.connect(gain(c, 0.4, out));
    loop(c, life, "brown", bedLp, -0.3);
    loop(c, life, "brown", bedLp, 0.3);
    // Two voices take turns: each wave builds, breaks and drags back.
    const voices = [-0.4, 0.4].map((pan) => {
      const lp = filter(c, "lowpass", 400, 0.3);
      const g = gain(c, 0.03, out);
      lp.connect(g);
      loop(c, life, "pink", lp, pan);
      return { lp, g };
    });
    let k = 0;
    events(c, life, 0.3, between(5, 9), (t) => {
      const { lp, g } = voices[k++ % 2];
      const up = rand(2, 3.5);
      const down = rand(4, 6.5);
      g.gain.setTargetAtTime(rand(0.7, 1.1), t, up / 2.5);
      g.gain.setTargetAtTime(0.03, t + up, down / 3);
      lp.frequency.setTargetAtTime(rand(1400, 2800), t, up / 2);
      lp.frequency.setTargetAtTime(350, t + up, down / 2.5);
    });
  },

  stream(c, out, life) {
    const bedLp = filter(c, "lowpass", 900);
    bedLp.connect(gain(c, 0.35, out));
    loop(c, life, "pink", bedLp, -0.3);
    loop(c, life, "pink", bedLp, 0.3);
    // Water babbling: narrow bands of noise that jump around quickly.
    for (const [f, pan] of [[450, -0.5], [800, 0.35], [1350, -0.2], [2200, 0.5], [3300, 0]] as const) {
      const bp = filter(c, "bandpass", f, 7);
      const g = gain(c, 0, out);
      bp.connect(g);
      loop(c, life, "white", bp, pan);
      events(c, life, rand(0, 0.1), between(0.04, 0.16), (t) => {
        bp.frequency.setTargetAtTime(f * rand(0.75, 1.4), t, 0.02);
        g.gain.setTargetAtTime(rand(0, 1) ** 2 * 3, t, 0.025);
      });
    }
  },

  wind(c, out, life) {
    for (const pan of [-0.6, 0.6]) {
      const bp = filter(c, "bandpass", 500, 1);
      const g = gain(c, 0.5, out);
      bp.connect(g);
      loop(c, life, "pink", bp, pan);
      wander(c, life, bp.frequency, 220, 900, [2, 6], 1.5);
      wander(c, life, bp.Q, 0.5, 2.5, [3, 7], 2);
      wander(c, life, g.gain, 0.2, 1.2, [1.5, 5], 1.2);
    }
    const low = filter(c, "lowpass", 200);
    low.connect(gain(c, 0.3, out));
    loop(c, life, "brown", low);
  },

  fire(c, out, life) {
    // The low roar of the flames, flickering…
    for (const pan of [-0.3, 0.3]) {
      const lp = filter(c, "lowpass", 450);
      const g = gain(c, 0.6, out);
      lp.connect(g);
      loop(c, life, "brown", lp, pan);
      wander(c, life, g.gain, 0.35, 1, [0.08, 0.3], 0.08);
    }
    const hiss = filter(c, "highpass", 2500);
    hiss.connect(gain(c, 0.06, out));
    loop(c, life, "pink", hiss);
    // …crackles that come in little clusters…
    events(c, life, 0.1, () => (Math.random() < 0.35 ? rand(0.005, 0.03) : rand(0.05, 0.6)), (t) =>
      burst(c, out, t, { freq: rand(1200, 6000), q: rand(0.5, 2), peak: rand(0.3, 1.2), decay: rand(0.0008, 0.003), pan: rand(-0.6, 0.6) }),
    );
    // …and the odd pop of a knot in the wood.
    events(c, life, rand(1, 4), between(1.5, 6), (t) =>
      burst(c, out, t, { freq: rand(300, 900), q: 1.5, peak: rand(0.8, 1.5), decay: rand(0.006, 0.02), pan: rand(-0.5, 0.5) }),
    );
  },

  birds(c, out, life) {
    const dry = gain(c, 1, out);
    const room = reverb(c, 2.5, gain(c, 0.4, out));
    const leaves = filter(c, "highpass", 3000);
    const rustle = gain(c, 0.03, out);
    leaves.connect(rustle);
    loop(c, life, "pink", leaves);
    wander(c, life, rustle.gain, 0.01, 0.07, [1, 4], 0.8);
    events(c, life, rand(0.3, 1.5), between(1.2, 5), (t) => {
      const bird = c.createStereoPanner();
      bird.pan.value = rand(-0.85, 0.85);
      const near = gain(c, rand(0.35, 1), dry);
      bird.connect(near);
      near.connect(room);
      const kind = pick(["whistle", "chirps", "trill"] as const);
      if (kind === "whistle") {
        let at = t;
        for (let n = Math.floor(rand(2, 5)); n > 0; n--) {
          const f = rand(1800, 3800);
          const dur = rand(0.12, 0.3);
          tone(c, bird, at, { freq: f, glideTo: f * rand(0.8, 1.3), peak: 0.22, attack: 0.02, end: dur });
          at += dur + rand(0.05, 0.15);
        }
      } else if (kind === "chirps") {
        let at = t;
        const f = rand(4000, 6000);
        for (let n = Math.floor(rand(3, 8)); n > 0; n--) {
          tone(c, bird, at, { freq: f * rand(0.95, 1.05), glideTo: f * 0.6, peak: 0.18, attack: 0.006, end: rand(0.04, 0.07) });
          at += rand(0.07, 0.11);
        }
      } else {
        const dur = rand(0.5, 1.2);
        const osc = tone(c, bird, t, { freq: rand(3000, 4500), peak: 0.14, attack: 0.05, end: dur });
        const lfo = c.createOscillator();
        lfo.frequency.value = rand(18, 30);
        const depth = gain(c, rand(250, 450));
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.2);
      }
    });
  },

  crickets(c, out, life) {
    const night = filter(c, "lowpass", 180);
    night.connect(gain(c, 0.2, out));
    loop(c, life, "brown", night);
    for (let i = 0; i < 3; i++) {
      const osc = c.createOscillator();
      osc.frequency.value = rand(4300, 5200);
      const g = gain(c, 0);
      osc.connect(g).connect(panned(c, rand(-0.8, 0.8), out));
      osc.start();
      life.sources.push(osc);
      const period = rand(0.55, 1.1);
      const pulses = Math.floor(rand(3, 6));
      const spacing = rand(0.028, 0.04);
      const level = rand(0.12, 0.3);
      let singing = true;
      events(c, life, rand(0, 1), between(period * 0.97, period * 1.03), (t) => {
        // Each one stops for a while now and then.
        if (Math.random() < (singing ? 0.03 : 0.15)) singing = !singing;
        if (!singing) return;
        for (let p = 0; p < pulses; p++) {
          const at = t + p * spacing;
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(level, at + 0.004);
          g.gain.linearRampToValueAtTime(0, at + 0.018);
        }
      });
    }
  },

  drift(c, out, life) {
    const bus = gain(c, 1);
    bus.connect(gain(c, 0.35, out));
    bus.connect(reverb(c, 4, gain(c, 0.9, out)));
    const lp = filter(c, "lowpass", 1600, 0.5);
    lp.connect(bus);
    wander(c, life, lp.frequency, 900, 2200, [6, 12], 4);
    // A pentatonic scale never clashes, so any notes go together.
    const root = pick([48, 50, 53, 55, 57]);
    const notes = [0, 12].flatMap((o) => [0, 2, 4, 7, 9].map((s) => root + o + s)).concat(root + 24);
    for (const [m, level] of [[root - 12, 0.05], [root - 5, 0.03]] as const) {
      const osc = c.createOscillator();
      osc.frequency.value = hz(m);
      const g = gain(c, level, lp);
      osc.connect(g);
      osc.start();
      life.sources.push(osc);
      wander(c, life, g.gain, level * 0.5, level * 1.3, [4, 9], 3);
    }
    const note = (t: number, m: number) => {
      const peak = rand(0.06, 0.12);
      const attack = rand(1.5, 3);
      const end = attack + rand(4, 7);
      tone(c, lp, t, { freq: hz(m), peak, attack, end });
      tone(c, lp, t, { freq: hz(m) * 1.003, type: "triangle", peak: peak * 0.4, attack, end });
    };
    let at = Math.floor(rand(3, 7));
    events(c, life, rand(0.2, 1), between(2.2, 4.8), (t) => {
      at = clamp(at + pick([-2, -1, 1, 2, 0]), 0, notes.length - 1);
      note(t, notes[at]);
      if (Math.random() < 0.35) note(t + rand(0.1, 0.6), notes[clamp(at + pick([-3, 2, 3]), 0, notes.length - 1)]);
    });
  },

  binaural(c, out, life, { beat }) {
    // A slightly different tone in each ear; the brain hears the difference as a slow pulse.
    const merge = c.createChannelMerger(2);
    merge.connect(out);
    [200, 200 + beat].forEach((f, ear) => {
      const osc = c.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain(c, 0.3)).connect(merge, 0, ear);
      osc.start();
      life.sources.push(osc);
    });
  },

  white(c, out, life) {
    const lp = filter(c, "lowpass", 9000, 0.5);
    lp.connect(gain(c, 1, out));
    loop(c, life, "white", lp, -0.5);
    loop(c, life, "white", lp, 0.5);
  },

  pink(c, out, life) {
    const g = gain(c, 1, out);
    loop(c, life, "pink", g, -0.5);
    loop(c, life, "pink", g, 0.5);
  },

  brown(c, out, life) {
    const g = gain(c, 1, out);
    loop(c, life, "brown", g, -0.5);
    loop(c, life, "brown", g, 0.5);
  },

  plane(c, out, life) {
    const lp = filter(c, "lowpass", 500, 0.5);
    const body = gain(c, 1, out);
    lp.connect(body);
    loop(c, life, "brown", lp, -0.4);
    loop(c, life, "brown", lp, 0.4);
    wander(c, life, body.gain, 0.85, 1.05, [4, 10], 3);
    const air = filter(c, "bandpass", 1200, 0.7);
    air.connect(gain(c, 0.15, out));
    loop(c, life, "pink", air);
  },

  clock(c, out, life) {
    let tock = false;
    events(c, life, 1 - (c.currentTime % 1), () => 1, (t) => {
      tock = !tock;
      burst(c, out, t, { freq: tock ? 2400 : 3100, q: 3, peak: 1.2, decay: 0.004 });
      tone(c, out, t, { freq: tock ? 900 : 1150, peak: 0.12, attack: 0.001, end: 0.05 });
    });
  },
};

/** How loud each sound is at the same slider position (measured, so the levels in a mix mean the same thing). */
const LEVEL: Record<string, number> = {
  rain: 1, thunder: 0.9, waves: 1, stream: 1.1, wind: 1.3, fire: 0.75, birds: 2.5, crickets: 1,
  drift: 2.5, binaural: 0.24, white: 0.45, pink: 0.45, brown: 0.5, plane: 0.5, clock: 1, own: 1,
};

/** Renders a sound offline: for checking levels. */
export async function renderSound(id: SoundId, seconds = 20, beat: Beat = 10) {
  const c = new OfflineAudioContext(2, 48000 * seconds, 48000);
  const life: Life = { stops: [], sources: [] };
  const out = gain(c, LEVEL[id], c.destination);
  MAKERS[id](c, out, life, { beat });
  return c.startRendering();
}

/* ---------- Your own files (kept on this device, in IndexedDB) ---------- */

const DB = "haven-focus-sounds";
let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction("files", mode);
    const req = fn(t.objectStore("files"));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}

export async function addOwnSound(file: File) {
  const id = Math.random().toString(36).slice(2, 10);
  await idb("readwrite", (s) => s.put(file, id));
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "My sound";
  const { own, setLayer, set } = useFocusSound.getState();
  set({ own: [...own, { id, name }] });
  setLayer(`own:${id}`, 0.6);
}

export async function removeOwnSound(id: string) {
  const { own, setLayer, set } = useFocusSound.getState();
  setLayer(`own:${id}`, null);
  set({ own: own.filter((o) => o.id !== id) });
  await idb("readwrite", (s) => s.delete(id)).catch(() => undefined);
}

function ownMaker(id: string): Maker {
  return (c, out, life) => {
    let stopped = false;
    let audio: HTMLAudioElement | null = null;
    let url = "";
    life.stops.push(() => {
      stopped = true;
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
    });
    void idb<Blob | undefined>("readonly", (s) => s.get(id)).then((blob) => {
      if (!blob || stopped || !(c instanceof AudioContext)) return;
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.loop = true;
      c.createMediaElementSource(audio).connect(out);
      void audio.play().catch(() => undefined);
    });
  };
}

/* ---------- Playing the mix ---------- */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
const live = new Map<string, { key: string; gain: GainNode; life: Life }>();

const audio = () => {
  ctx ??= new AudioContext();
  clearTimeout(idle);
  void ctx.resume();
  return ctx;
};

/** Slider position to loudness: our ears hear loudness roughly by powers. */
const loudness = (v: number) => v ** 1.8;

function fadeOut(id: string) {
  const layer = live.get(id);
  if (!layer || !ctx) return;
  live.delete(id);
  layer.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => {
    layer.life.stops.forEach((f) => f());
    layer.life.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    layer.gain.disconnect();
  }, 2500);
}

/** Plays a mix (or moves smoothly to a new one). */
export function playMix(mix: Mix, volume: number, beat: Beat) {
  const wanted = Object.entries(mix).filter(([, v]) => v > 0);
  if (!wanted.length) return stopMix();
  const c = audio();
  if (!master) {
    master = gain(c, 0);
    // Keeps a big mix from distorting.
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -8;
    limit.knee.value = 6;
    limit.ratio.value = 6;
    master.connect(limit).connect(c.destination);
  }
  master.gain.setTargetAtTime(loudness(volume) * 1.2, c.currentTime, 0.3);
  const keyOf = (id: string) => (id === "binaural" ? `binaural:${beat}` : id);
  for (const [id, layer] of live) if (!(mix[id] > 0) || layer.key !== keyOf(id)) fadeOut(id);
  for (const [id, v] of wanted) {
    const own = id.startsWith("own:");
    const make = own ? ownMaker(id.slice(4)) : MAKERS[id as SoundId];
    if (!make) continue;
    const level = loudness(v) * (LEVEL[own ? "own" : id] ?? 1);
    const layer = live.get(id);
    if (layer) {
      layer.gain.gain.setTargetAtTime(level, c.currentTime, 0.2);
      continue;
    }
    const g = gain(c, 0, master);
    const life: Life = { stops: [], sources: [] };
    make(c, g, life, { beat });
    g.gain.setTargetAtTime(level, c.currentTime, 0.8);
    live.set(id, { key: keyOf(id), gain: g, life });
  }
}

export function stopMix() {
  for (const id of [...live.keys()]) fadeOut(id);
  // Nothing playing: let the sound device rest.
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (!live.size) void ctx?.suspend();
  }, 8000);
}

/* ---------- The bell at the end ---------- */

/** The sound at the end of a session or a break. */
export function chime(kind: Bell = useFocusSound.getState().bell) {
  if (kind === "none") return;
  try {
    const c = audio();
    const out = gain(c, 1, c.destination);
    const now = c.currentTime + 0.02;
    if (kind === "bell") {
      [659.25, 987.77].forEach((f, i) => tone(c, out, now + i * 0.22, { freq: f, peak: 0.18, attack: 0.02, end: 1.8 }));
    } else if (kind === "bowl") {
      // Struck metal: partials that aren't multiples of each other, each pair slightly apart so they shimmer.
      [[1, 0.16, 7], [2.76, 0.07, 5], [5.4, 0.035, 3.5], [8.93, 0.015, 2.5]].forEach(([r, peak, end]) => {
        tone(c, out, now, { freq: 196 * r, peak, attack: 0.005, end });
        tone(c, out, now, { freq: 196 * r + 0.8 * r, peak: peak * 0.7, attack: 0.005, end });
      });
    } else if (kind === "chimes") {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        tone(c, out, now + i * 0.18, { freq: f, peak: 0.12, attack: 0.005, end: 2.5 });
        tone(c, out, now + i * 0.18, { freq: f * 2.76, peak: 0.02, attack: 0.005, end: 1 });
      });
    } else {
      [0, 0.3].forEach((d) =>
        [523.25, 784].forEach((f, i) => {
          tone(c, out, now + d + i * 0.12, { freq: f, peak: 0.25, attack: 0.002, end: 0.35 });
          tone(c, out, now + d + i * 0.12, { freq: f * 4, peak: 0.04, attack: 0.001, end: 0.08 });
        }),
      );
    }
    setTimeout(() => out.disconnect(), 9000);
    if (!live.size) stopMix();
  } catch {
    /* no sound available */
  }
}

