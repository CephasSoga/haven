import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WorkerIn, WorkerOut } from "./voice.worker";

/**
 * The voices read-aloud can use.
 *  - Live reading needs a voice that's made faster than it's spoken. On an ordinary computer that's
 *    the computer's own voices (instant), or Piper's lightest voices where there's one.
 *  - Preparing a chapter as audio happens in the background, so it can use Piper's natural-sounding
 *    "medium" voices, which take longer to make than to play.
 */

export type Lang = "en" | "fr" | "es" | "it" | "pt";
export const LANGS: Record<Lang, string> = { en: "English", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese" };

export type Voice = { id: string; engine: "system" | "piper"; label: string; lang: Lang };

/** Piper voices light enough to read live (~28 MB). */
const LIVE_PIPER: Voice[] = [
  { id: "fr_FR-siwis-low", engine: "piper", label: "Siwis (on-device)", lang: "fr" },
  { id: "es_ES-carlfm-x_low", engine: "piper", label: "Carlfm (on-device)", lang: "es" },
  { id: "it_IT-riccardo-x_low", engine: "piper", label: "Riccardo (on-device)", lang: "it" },
];

/** Natural voices for preparing chapters (~63–77 MB each). */
export const NATURAL: Voice[] = [
  { id: "en_US-lessac-medium", engine: "piper", label: "Lessac (US, woman)", lang: "en" },
  { id: "en_US-ryan-medium", engine: "piper", label: "Ryan (US, man)", lang: "en" },
  { id: "en_GB-alba-medium", engine: "piper", label: "Alba (UK, woman)", lang: "en" },
  { id: "en_GB-northern_english_male-medium", engine: "piper", label: "Northern English (UK, man)", lang: "en" },
  { id: "fr_FR-siwis-medium", engine: "piper", label: "Siwis (woman)", lang: "fr" },
  { id: "fr_FR-tom-medium", engine: "piper", label: "Tom (man)", lang: "fr" },
  { id: "fr_FR-upmc-medium", engine: "piper", label: "UPMC (woman)", lang: "fr" },
  { id: "es_ES-davefx-medium", engine: "piper", label: "Davefx (man)", lang: "es" },
  { id: "it_IT-paola-medium", engine: "piper", label: "Paola (woman)", lang: "it" },
  { id: "pt_BR-faber-medium", engine: "piper", label: "Faber (Brazil, man)", lang: "pt" },
];

/** The computer's own voices for a language (Windows: Mark, Zira, Hortense…). */
export function systemVoices(lang: Lang): Voice[] {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(lang))
    .sort((a, b) => Number(b.localService) - Number(a.localService))
    .map((v) => ({ id: `system:${v.name}`, engine: "system" as const, label: v.name.replace(/^Microsoft /, "").replace(/ - .*$/, "") + (v.localService ? "" : " (online)"), lang }));
}

/** Voices for reading live, best first. */
export function liveVoices(lang: Lang): Voice[] {
  return [...LIVE_PIPER.filter((v) => v.lang === lang), ...systemVoices(lang)];
}

/** Choices remembered on this device. */
type Prefs = { live: Partial<Record<Lang, string>>; natural: Partial<Record<Lang, string>>; speed: number; set: (p: Partial<Omit<Prefs, "set">>) => void };
export const useVoicePrefs = create<Prefs>()(persist((set) => ({ live: {}, natural: {}, speed: 1, set }), { name: "haven:read-aloud" }));

export function liveVoiceFor(lang: Lang) {
  const all = liveVoices(lang);
  return all.find((v) => v.id === useVoicePrefs.getState().live[lang]) ?? all[0] ?? null;
}

export function naturalVoiceFor(lang: Lang) {
  const all = NATURAL.filter((v) => v.lang === lang);
  return all.find((v) => v.id === useVoicePrefs.getState().natural[lang]) ?? all[0] ?? null;
}

/* ---------- Telling the language ---------- */

const STOPWORDS: Record<Lang, string[]> = {
  en: ["the", "and", "of", "to", "is", "that", "it", "with", "was", "for"],
  fr: ["le", "la", "les", "des", "est", "et", "une", "que", "pour", "dans", "qui", "pas"],
  es: ["el", "los", "las", "es", "y", "una", "que", "para", "por", "con", "del"],
  it: ["il", "gli", "è", "e", "una", "che", "per", "con", "non", "della", "sono"],
  pt: ["o", "os", "as", "é", "e", "uma", "que", "para", "com", "não", "do", "da"],
};

/** From a book's own label ("fr-FR") when there is one, else by its most common small words. */
export function detectLang(text: string, declared?: string | null): Lang {
  const tag = declared?.slice(0, 2).toLowerCase();
  if (tag && tag in LANGS) return tag as Lang;
  const words = text.toLowerCase().match(/\p{L}+/gu)?.slice(0, 600) ?? [];
  let best: Lang = "en";
  let score = 0;
  for (const lang of Object.keys(STOPWORDS) as Lang[]) {
    const set = new Set(STOPWORDS[lang]);
    const s = words.filter((w) => set.has(w)).length;
    if (s > score) [best, score] = [lang, s];
  }
  return best;
}

/* ---------- The voice worker ---------- */

/**
 * Two workers: one for reading live, one for preparing chapters in the background, so a long
 * preparation never makes live reading wait its turn.
 */
export type Lane = "live" | "background";
const workers: Partial<Record<Lane, Worker>> = {};
let nextId = 1;
const waiting = new Map<number, { resolve: (r: { audio: Float32Array; rate: number }) => void; reject: (e: Error) => void }>();
const loading = new Map<string, { resolve: () => void; reject: (e: Error) => void; progress?: (p: number) => void }[]>();
const ready = new Set<string>();

function getWorker(lane: Lane) {
  const existing = workers[lane];
  if (existing) return existing;
  const worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
  workers[lane] = worker;
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    const key = `${lane}:${m.type === "audio" ? "" : (m.voice ?? "")}`;
    if (m.type === "progress") loading.get(key)?.forEach((l) => l.progress?.(m.progress));
    else if (m.type === "ready") {
      ready.add(key);
      loading.get(key)?.forEach((l) => l.resolve());
      loading.delete(key);
    } else if (m.type === "audio") {
      waiting.get(m.id)?.resolve({ audio: m.audio, rate: m.rate });
      waiting.delete(m.id);
    } else if (m.type === "error") {
      const err = new Error(m.message);
      if (m.id !== undefined) {
        waiting.get(m.id)?.reject(err);
        waiting.delete(m.id);
      } else if (m.voice) {
        loading.get(key)?.forEach((l) => l.reject(err));
        loading.delete(key);
      }
    }
  };
  return worker;
}

const send = (lane: Lane, m: WorkerIn) => getWorker(lane).postMessage(m);

/** Downloads (the first time) and warms up a Piper voice. */
export function loadPiper(voice: string, progress?: (p: number) => void, lane: Lane = "live") {
  const key = `${lane}:${voice}`;
  if (ready.has(key)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const list = loading.get(key);
    if (list) list.push({ resolve, reject, progress });
    else {
      loading.set(key, [{ resolve, reject, progress }]);
      send(lane, { type: "load", voice });
    }
  });
}

/** One sentence (or a few), as audio. */
export function piperSpeak(text: string, voice: string, speed = 1, lane: Lane = "live") {
  const id = nextId++;
  return new Promise<{ audio: Float32Array; rate: number }>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    send(lane, { type: "speak", id, text, voice, speed });
  });
}

/** Frees a lane's voices (and memory) when it's no longer needed. */
export function closeLane(lane: Lane) {
  workers[lane]?.terminate();
  delete workers[lane];
  for (const key of [...ready]) if (key.startsWith(`${lane}:`)) ready.delete(key);
}
