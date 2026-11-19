/// <reference lib="webworker" />
/**
 * Read-aloud voices made on this device with Piper (open-source speech models, 28–80 MB per voice)
 * and eSpeak NG, which works out how each word is pronounced. Voices and pronunciation data are
 * downloaded the first time and kept by the browser; the book's text never leaves the device.
 * Runs off the main thread so pages stay smooth while it works.
 */
// The same build of ONNX Runtime the rest of Haven uses (transformers.js), so its engine file is shared.
import * as ort from "onnxruntime-web/webgpu";
import espeakFactory from "@echogarden/espeak-ng-emscripten";

// eSpeak's pronunciation data for every language (24 MB): fetched on first use, not shipped in the app.
const ESPEAK_DATA = "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/espeak-ng.data";
const PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const CACHE = "haven-voices";

// The engine itself comes from the same place transformers.js (meeting transcription) gets it.
const ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
ort.env.wasm.wasmPaths = { mjs: `${ORT}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ORT}ort-wasm-simd-threaded.asyncify.wasm` };


export type WorkerIn =
  | { type: "load"; voice: string }
  | { type: "speak"; id: number; text: string; voice: string; speed: number };

export type WorkerOut =
  | { type: "progress"; voice: string; progress: number }
  | { type: "ready"; voice: string }
  | { type: "audio"; id: number; audio: Float32Array; rate: number }
  | { type: "error"; id?: number; voice?: string; message: string };

const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Downloads once (with progress), then reads from the browser's cache. */
async function cached(url: string, onProgress?: (p: number) => void) {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  } catch {
    /* no cache available: just download */
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the voice (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(got / total);
  }
  const buf = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.length;
  }
  await cache?.put(url, new Response(buf.slice(0))).catch(() => {});
  return buf.buffer;
}

/* ---------- Pronunciation (eSpeak NG) ---------- */

type Espeak = {
  getPointer: (p: unknown) => number;
  HEAPU8: Uint8Array;
  eSpeakNGWorker: new () => { set_voice: (v: string) => void; text_to_phonemes: (t: string, ipa: number) => unknown };
};

let espeak: Promise<{ mod: Espeak; worker: InstanceType<Espeak["eSpeakNGWorker"]> }> | null = null;
function loadEspeak(onProgress?: (p: number) => void) {
  espeak ??= (async () => {
    const data = await cached(ESPEAK_DATA, onProgress);
    // Handed over directly, so eSpeak doesn't try to fetch it again from where it thinks it lives.
    const mod = (await (espeakFactory as unknown as (o: object) => Promise<Espeak>)({ getPreloadedPackage: () => data, locateFile: (p: string) => p })) as Espeak;
    return { mod, worker: new mod.eSpeakNGWorker() };
  })().catch((e) => {
    espeak = null;
    throw e;
  });
  return espeak;
}

// Punctuation stays as it is (the voice reads it for pauses and tone); the words between become phonemes.
const PUNCT_RUN = /(\s*[;:,.!?¡¿—…"«»“”()[\]{}]+\s*)+/g;

async function phonemize(text: string, lang: string) {
  const { mod, worker } = await loadEspeak();
  worker.set_voice(lang);
  const read = (p: unknown) => {
    const ptr = mod.getPointer(p);
    const heap = mod.HEAPU8;
    let end = ptr;
    while (heap[end]) end++;
    return new TextDecoder().decode(heap.subarray(ptr, end));
  };
  const clean = text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  let last = 0;
  for (const m of clean.matchAll(PUNCT_RUN)) {
    if (m.index! > last) parts.push(read(worker.text_to_phonemes(clean.slice(last, m.index), 1)));
    parts.push(m[0]);
    last = m.index! + m[0].length;
  }
  if (last < clean.length) parts.push(read(worker.text_to_phonemes(clean.slice(last), 1)));
  // eSpeak marks the boundaries between phonemes and clauses; Piper wants the plain sounds.
  return parts.join("").replace(/[_|]/g, "").replace(/(?<=\S)-(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
}

/* ---------- Speech (Piper) ---------- */

type Config = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_id_map: Record<string, number[]>;
};
type Voice = { session: ort.InferenceSession; config: Config };

const voices = new Map<string, Promise<Voice>>();

/** "fr_FR-siwis-low" → its files on Hugging Face. */
const voicePath = (name: string) => {
  const [locale, speaker, quality] = name.split("-");
  return `${PIPER}/${locale.split("_")[0]}/${locale}/${speaker}/${quality}/${name}`;
};

function loadVoice(name: string) {
  let v = voices.get(name);
  if (!v) {
    v = (async () => {
      // Progress covers the voice and (the first time) eSpeak's data, together.
      let pv = 0;
      let pe = 0;
      const report = () => post({ type: "progress", voice: name, progress: pv * 0.75 + pe * 0.25 });
      const [model, config] = await Promise.all([
        cached(`${voicePath(name)}.onnx`, (p) => {
          pv = p;
          report();
        }),
        cached(`${voicePath(name)}.onnx.json`).then((b) => JSON.parse(new TextDecoder().decode(b)) as Config),
        loadEspeak((p) => {
          pe = p;
          report();
        }),
      ]);
      const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
      return { session, config };
    })().catch((e) => {
      voices.delete(name);
      throw e;
    });
    voices.set(name, v);
  }
  return v;
}

async function speak(text: string, name: string, speed: number) {
  const { session, config } = await loadVoice(name);
  const phonemes = await phonemize(text, config.espeak.voice);
  const map = config.phoneme_id_map;
  const ids: number[] = [...map["^"]];
  for (const ch of Array.from(phonemes.normalize("NFD"))) {
    if (!map[ch]) continue;
    ids.push(...map[ch], ...map["_"]);
  }
  ids.push(...map["$"]);
  if (ids.length <= 3) return { audio: new Float32Array(0), rate: config.audio.sample_rate };
  const { noise_scale, length_scale, noise_w } = config.inference;
  const out = await session.run({
    input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    // A longer "length" is slower speech: speed 1.25 → 0.8 of the usual length.
    scales: new ort.Tensor("float32", Float32Array.from([noise_scale, length_scale / Math.max(0.5, Math.min(2, speed)), noise_w]), [3]),
  });
  return { audio: out.output.data as Float32Array, rate: config.audio.sample_rate };
}

/* ---------- Messages ---------- */

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === "load") {
    try {
      await loadVoice(m.voice);
      post({ type: "ready", voice: m.voice });
    } catch (err) {
      post({ type: "error", voice: m.voice, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (m.type === "speak") {
    try {
      const { audio, rate } = await speak(m.text, m.voice, m.speed);
      post({ type: "audio", id: m.id, audio, rate }, [audio.buffer]);
    } catch (err) {
      post({ type: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
