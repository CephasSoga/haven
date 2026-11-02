/// <reference lib="webworker" />
/**
 * Runs Whisper (open-source speech recognition) inside the browser, off the main thread.
 * Models are downloaded once from Hugging Face and cached by the browser; audio never leaves the device.
 *   base  — quick enough to keep up live while you record
 *   small — slower and much better, for redoing the transcript after the meeting
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperModel = "base" | "small";

const MODELS: Record<WhisperModel, string> = {
  base: "onnx-community/whisper-base",
  small: "onnx-community/whisper-small",
};

type In =
  | { type: "load"; model: WhisperModel }
  | { type: "unload"; model: WhisperModel }
  | { type: "transcribe"; id: number; model: WhisperModel; audio: Float32Array; language: string; timestamps?: boolean };

const loaded = new Map<WhisperModel, Promise<AutomaticSpeechRecognitionPipeline>>();
let device: "webgpu" | "wasm" | null = null;

async function pickDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    /* fall through */
  }
  return "wasm";
}

function load(model: WhisperModel) {
  let p = loaded.get(model);
  if (!p) {
    p = (async () => {
      device ??= await pickDevice();
      const asr = await pipeline("automatic-speech-recognition", MODELS[model], {
        device,
        // On the GPU a full-precision encoder keeps accuracy; on the CPU 8-bit weights keep it quick.
        dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === "progress") postMessage({ type: "progress", model, file: p.file, progress: p.progress ?? 0 });
        },
      });
      return asr as AutomaticSpeechRecognitionPipeline;
    })();
    loaded.set(model, p);
  }
  return p;
}

/** Collapses a phrase repeated three or more times in a row down to one, in case a loop slips through. */
function unloop(text: string) {
  return text.replace(/(\b.{3,60}?)(?:\s*\1){2,}/gu, "$1");
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    // Every "load" gets an answer, including after the first: each recording waits for it.
    if (msg.type === "load") {
      await load(msg.model);
      postMessage({ type: "ready", model: msg.model, device });
    }
    if (msg.type === "unload") {
      const p = loaded.get(msg.model);
      loaded.delete(msg.model);
      await (await p)?.dispose();
    }
    if (msg.type === "transcribe") {
      const t = await load(msg.model);
      const seconds = msg.audio.length / 16_000;
      const out = await t(msg.audio, {
        language: msg.language,
        task: "transcribe",
        ...(msg.timestamps ? { return_timestamps: true } : {}),
        // Whisper can get stuck repeating a phrase until it runs out of room ("de la portée de la portée…"),
        // which is both wrong and slow. Nobody says more than ~6 words a second, and real speech rarely
        // repeats the same four words back to back.
        max_new_tokens: Math.min(440, Math.ceil(seconds * 9) + 16),
        no_repeat_ngram_size: 4,
      } as Record<string, unknown>);
      const one = Array.isArray(out) ? out[0] : out;
      const chunks = (one as { chunks?: { text: string; timestamp: [number, number | null] }[] }).chunks;
      postMessage({ type: "result", id: msg.id, text: unloop(one.text), chunks: chunks?.map((c) => ({ ...c, text: unloop(c.text) })) });
    }
  } catch (err) {
    if (msg.type !== "unload") loaded.delete(msg.model);
    postMessage({ type: "error", model: msg.model, id: "id" in msg ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
