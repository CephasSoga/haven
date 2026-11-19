import { create } from "zustand";
import { pause as pausePodcast } from "@/modules/podcasts/player";
import type { Sentence } from "./sentences";
import { liveVoiceFor, loadPiper, piperSpeak, useVoicePrefs, type Lang, type Voice } from "./voices";

/**
 * Reads the book aloud from where you are: sentence by sentence, highlighting each one and turning
 * pages as it goes. The next few sentences are made while one is being read, so on-device voices
 * have a head start.
 */

export type ReadBatch = { lang: Lang; sentences: Sentence[] };

/** What the reader (PDF or EPUB view) provides: the text, and how to show where it's at. */
export type ReadSource = {
  /** The sentences from where you are; on later calls, the next page or chapter; null at the end */
  next: () => Promise<ReadBatch | null>;
  /** Highlights a sentence and brings it into view */
  show: (s: Sentence) => void;
  clear: () => void;
};

type Status = "idle" | "loading" | "playing" | "paused" | "waiting" | "error";
type State = { status: Status; progress: number; voice: Voice | null; lang: Lang | null; error: string | null };
export const useReadAloud = create<State>(() => ({ status: "idle", progress: 0, voice: null, lang: null, error: null }));
const set = useReadAloud.setState;

type Prepared = { kind: "piper"; audio: Float32Array; rate: number } | { kind: "system"; text: string };

type Session = {
  source: ReadSource;
  stopped: boolean;
  paused: boolean;
  voice: Voice;
  idx: number;
  jump?: number;
  ahead: Map<number, Promise<Prepared>>;
  /** Interrupts what's playing now */
  cut?: () => void;
};

let session: Session | null = null;
let ctx: AudioContext | null = null;

/* ---------- Voices ---------- */

const speed = () => useVoicePrefs.getState().speed;

function prepare(s: Session, text: string): Promise<Prepared> {
  if (s.voice.engine === "system") return Promise.resolve({ kind: "system", text });
  return piperSpeak(text, s.voice.id, speed()).then((r) => ({ kind: "piper", ...r }));
}

function play(s: Session, p: Prepared) {
  return new Promise<void>((resolve) => {
    if (p.kind === "system") {
      const u = new SpeechSynthesisUtterance(p.text);
      const v = speechSynthesis.getVoices().find((x) => `system:${x.name}` === s.voice.id);
      if (v) (u.voice = v), (u.lang = v.lang);
      u.rate = speed();
      u.onend = u.onerror = () => resolve();
      s.cut = () => {
        u.onend = u.onerror = null;
        speechSynthesis.cancel();
        resolve();
      };
      speechSynthesis.speak(u);
      return;
    }
    if (!p.audio.length) return resolve();
    ctx ??= new AudioContext();
    const buffer = ctx.createBuffer(1, p.audio.length, p.rate);
    buffer.copyToChannel(p.audio as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    s.cut = () => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* already over */
      }
      resolve();
    };
    src.start();
  });
}

/* ---------- Reading ---------- */

export async function startReading(source: ReadSource) {
  stopReading();
  pausePodcast();
  set({ status: "loading", progress: 0, error: null });
  ctx ??= new AudioContext();
  void ctx.resume();
  const first = await source.next().catch(() => null);
  if (!first?.sentences.length) return set({ status: "error", error: "There's no text to read here. (A scanned page has only pictures of text.)" });
  const voice = liveVoiceFor(first.lang);
  if (!voice) return set({ status: "error", error: "There's no voice for this language on this device yet." });
  const s: Session = { source, stopped: false, paused: false, voice, idx: 0, ahead: new Map() };
  session = s;
  set({ voice, lang: first.lang });
  try {
    if (voice.engine === "piper") await loadPiper(voice.id, (p) => set({ progress: p }));
  } catch (e) {
    if (session === s) set({ status: "error", error: `The voice couldn't be downloaded: ${e instanceof Error ? e.message : e}` });
    return;
  }
  if (s.stopped) return;
  void loop(s, first);
}

async function loop(s: Session, firstBatch: ReadBatch) {
  let batch: ReadBatch | null = firstBatch;
  try {
    while (!s.stopped && batch) {
      if (s.idx >= batch.sentences.length) {
        s.idx = 0;
        s.ahead.clear();
        batch = await s.source.next();
        continue;
      }
      // Make the next few while this one is read.
      for (let k = s.idx; k < Math.min(batch.sentences.length, s.idx + 3); k++) if (!s.ahead.has(k)) s.ahead.set(k, prepare(s, batch.sentences[k].text));
      const pending = s.ahead.get(s.idx)!;
      let done = false;
      void pending.finally(() => (done = true));
      await Promise.resolve();
      if (!done && !s.paused) set({ status: "waiting" });
      const ready = await pending;
      if (s.stopped) break;
      while (s.paused && !s.stopped) await new Promise((r) => setTimeout(r, 150));
      if (s.stopped) break;
      s.source.show(batch.sentences[s.idx]);
      set({ status: "playing" });
      await play(s, ready);
      s.cut = undefined;
      for (const k of s.ahead.keys()) if (k <= s.idx) s.ahead.delete(k);
      if (s.jump !== undefined) {
        s.idx = Math.max(0, Math.min(batch.sentences.length - 1, s.jump));
        s.jump = undefined;
        s.ahead.clear();
      } else s.idx++;
    }
  } catch (e) {
    if (session === s) set({ status: "error", error: `Reading stopped: ${e instanceof Error ? e.message : e}` });
    s.source.clear();
    return;
  }
  s.source.clear();
  if (session === s) {
    session = null;
    set({ status: "idle" });
  }
}

export function pauseReading() {
  const s = session;
  if (!s || s.paused) return;
  s.paused = true;
  if (s.voice.engine === "system") speechSynthesis.pause();
  else void ctx?.suspend();
  set({ status: "paused" });
}

export function resumeReading() {
  const s = session;
  if (!s || !s.paused) return;
  s.paused = false;
  if (s.voice.engine === "system") speechSynthesis.resume();
  else void ctx?.resume();
  set({ status: "playing" });
}

/** Back or forward one sentence. */
export function skip(delta: number) {
  const s = session;
  if (!s) return;
  s.jump = s.idx + delta;
  if (s.paused) resumeReading();
  s.cut?.();
}

/** A different voice from the next sentence on. */
export async function switchVoice(v: Voice) {
  const s = session;
  const lang = useReadAloud.getState().lang;
  if (lang) useVoicePrefs.getState().set({ live: { ...useVoicePrefs.getState().live, [lang]: v.id } });
  if (!s) return;
  if (v.engine === "piper") {
    set({ status: "loading", progress: 0 });
    await loadPiper(v.id, (p) => set({ progress: p })).catch(() => {});
  }
  s.voice = v;
  set({ voice: v });
  s.jump = s.idx;
  s.cut?.();
}

/** New speed from the next sentence on. */
export function setReadingSpeed(value: number) {
  useVoicePrefs.getState().set({ speed: value });
  const s = session;
  if (!s) return;
  for (const k of s.ahead.keys()) if (k > s.idx) s.ahead.delete(k);
}

export function stopReading() {
  const s = session;
  session = null;
  if (s) {
    s.stopped = true;
    s.cut?.();
    if (s.voice.engine === "system") speechSynthesis.cancel();
    void ctx?.resume();
    s.source.clear();
  }
  set({ status: "idle", error: null });
}
