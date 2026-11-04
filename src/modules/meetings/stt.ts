import { create } from "zustand";
import { persist } from "zustand/middleware";
import { inApp } from "@/lib/platform";
import { useAi } from "@/lib/ai";

/**
 * Optional cloud transcription. Claude can't take audio, so this is a separate service with its own
 * API key; by default everything is transcribed on this device instead. Like the Anthropic key, the
 * key is stored in this browser only (it isn't synced) and audio goes straight to the service.
 */

export type SttProvider = "device" | "groq" | "openai";

export const STT_PROVIDERS: { id: SttProvider; label: string; hint: string; keyUrl?: string }[] = [
  {
    id: "openai",
    label: "OpenAI (GPT Transcribe)",
    hint: "Recommended. The most accurate, especially with names, accents and mixed languages. Priced per minute of audio.",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  { id: "groq", label: "Groq (Whisper large v3 turbo)", hint: "Accurate and very cheap — about $0.04 per hour of speech.", keyUrl: "https://console.groq.com/keys" },
  { id: "device", label: "On this device", hint: "Private and free, but rough while you record — use “Improve transcript” afterwards." },
];

type SttState = {
  provider: SttProvider;
  /** Keys typed here before AI shared them; they now live with the AI settings (useAi) */
  keys: Partial<Record<Exclude<SttProvider, "device">, string>>;
  set: (patch: Partial<Pick<SttState, "provider" | "keys">>) => void;
};

export const useStt = create<SttState>()(
  persist(
    (set) => ({
      // Used as soon as it has a key; until then everything is transcribed on this device.
      provider: "openai",
      keys: {},
      set: (patch) => set(patch),
    }),
    { name: "haven:stt", version: 1 },
  ),
);

/** The cloud service to use, when one is chosen and has a key. */
export function cloudStt() {
  const { provider } = useStt.getState();
  if (provider === "device") return null;
  // The same OpenAI or Groq key as in Settings → AI.
  const key = useAi.getState().keys[provider]?.trim();
  return key ? { provider, key } : null;
}

/** The cloud service transcribing meetings right now (it has a key), for showing on the page. */
export function useCloudStt() {
  const provider = useStt((s) => s.provider);
  const hasKey = useAi((s) => provider !== "device" && !!s.keys[provider]?.trim());
  return hasKey && provider !== "device" ? provider : null;
}

/** 16 kHz mono float samples → a 16-bit WAV file. */
export function toWav(audio: Float32Array, rate = 16_000) {
  const buf = new ArrayBuffer(44 + audio.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + audio.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

export class SttError extends Error {}

/** Checks the key with a second of silence (an empty transcript costs next to nothing). */
export const testStt = () => cloudTranscribe(new Float32Array(16_000), "en");

/**
 * Transcribes one utterance with the chosen service.
 * `language` is a two-letter code; `context` is the conversation just before, which helps with names and spelling.
 */
export async function cloudTranscribe(audio: Float32Array, language: string, context = "") {
  const svc = cloudStt();
  if (!svc) throw new SttError("No transcription service is set up.");
  const form = new FormData();
  form.append("file", toWav(audio), "speech.wav");
  const prompt = context.slice(-600);
  if (svc.provider === "groq") {
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", language);
    form.append("temperature", "0");
    form.append("response_format", "json");
    if (prompt) form.append("prompt", prompt);
  } else {
    form.append("model", "gpt-transcribe");
    form.append("languages[]", language);
    if (prompt) form.append("prompt", prompt);
  }
  const url = svc.provider === "groq" ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
  // Inside the apps, requests go through Tauri so the service's browser rules (CORS) don't apply.
  const doFetch = inApp ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
  const name = svc.provider === "groq" ? "Groq" : "OpenAI";
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: { Authorization: `Bearer ${svc.key}` }, body: form });
  } catch {
    // In a browser tab (not the apps), the service may also refuse to answer web pages directly.
    throw new SttError(inApp ? `Couldn't reach ${name}. Check your internet connection.` : `Couldn't reach ${name} from this browser — check your connection, or use the Haven app.`);
  }
  if (res.status === 401) throw new SttError(`${name} didn't accept the API key. Check it in Settings.`);
  if (res.status === 429) throw new SttError("The transcription service is rate limiting — some lines will be transcribed on this device.");
  if (!res.ok) throw new SttError(`The transcription service answered ${res.status}.`);
  const out = (await res.json()) as { text?: string };
  return (out.text ?? "").trim();
}
