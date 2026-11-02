/// <reference lib="webworker" />
/**
 * Runs Whisper (open-source speech recognition) inside the browser, off the main thread.
 * The model is downloaded once from Hugging Face and cached by the browser; audio never leaves the device.
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-base";

type In =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array; language: string };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function pickDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    /* fall through */
  }
  return "wasm";
}

function load() {
  asr ??= (async () => {
    const device = await pickDevice();
    const p = await pipeline("automatic-speech-recognition", MODEL, {
      device,
      // On the GPU a full-precision encoder keeps accuracy; on the CPU 8-bit weights keep it quick.
      dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === "progress") postMessage({ type: "progress", file: p.file, progress: p.progress ?? 0 });
      },
    });
    postMessage({ type: "ready", device });
    return p as AutomaticSpeechRecognitionPipeline;
  })();
  return asr;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") await load();
    if (msg.type === "transcribe") {
      const t = await load();
      const out = await t(msg.audio, { language: msg.language, task: "transcribe" });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      postMessage({ type: "result", id: msg.id, text });
    }
  } catch (err) {
    asr = null;
    postMessage({ type: "error", id: "id" in msg ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
