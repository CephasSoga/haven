/**
 * "Headphones mode": records your microphone and the meeting's own audio (a shared tab, or the
 * whole system's sound) as two separate streams, cuts them into utterances at pauses, and
 * transcribes each — with Whisper running locally, or with a cloud service when one is set up.
 * Keeping the streams apart is what lets the transcript say who spoke: "You" (microphone) or
 * "Them" (the meeting).
 */
import { uid } from "@/lib/utils";
import { saveClip, toPcm } from "./clips";
import { cloudStt, cloudTranscribe } from "./stt";
import type { WhisperModel } from "./whisper.worker";

const RATE = 16_000;
const FRAME = RATE / 10; // 100 ms
const PAUSE_FRAMES = 7; // 700 ms of quiet ends an utterance
const LEAD_IN_FRAMES = 3; // keep 300 ms before speech starts, so soft first syllables aren't clipped

const WHISPER_LANG: Record<string, string> = {
  en: "english",
  fr: "french",
  es: "spanish",
  de: "german",
  pt: "portuguese",
  it: "italian",
  nl: "dutch",
};

export const whisperLanguage = (bcp47: string) => WHISPER_LANG[bcp47.slice(0, 2)] ?? "english";

// Whisper sometimes "hears" these in near-silence; drop them when they're all there is.
export const PHANTOMS = /^(thank you\.?|thanks for watching!?|you|bye\.?|merci\.?|sous-titres.*|subtitles by.*|\[.*\]|\(.*\)|\.+)$/i;

type Status = { phase: "loading"; progress: number } | { phase: "ready"; device: string } | { phase: "listening" } | { phase: "error"; message: string };
type Chunk = { text: string; timestamp: [number, number | null] };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: { text: string; chunks?: Chunk[] }) => void; reject: (e: Error) => void }>();
const statusListeners = new Set<(s: Status & { model?: WhisperModel }) => void>();
const progressByFile = new Map<string, number>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      progressByFile.set(`${m.model}/${m.file}`, m.progress);
      const values = [...progressByFile].filter(([k]) => k.startsWith(`${m.model}/`)).map(([, v]) => v);
      const progress = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
      statusListeners.forEach((l) => l({ phase: "loading", progress, model: m.model }));
    } else if (m.type === "ready") {
      statusListeners.forEach((l) => l({ phase: "ready", device: m.device, model: m.model }));
    } else if (m.type === "result") {
      pending.get(m.id)?.resolve({ text: m.text, chunks: m.chunks });
      pending.delete(m.id);
    } else if (m.type === "error") {
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!.reject(new Error(m.message));
        pending.delete(m.id);
      } else statusListeners.forEach((l) => l({ phase: "error", message: m.message, model: m.model }));
    }
  };
  return worker;
}

/** Downloads (first time) and warms up a speech model. */
export function prepareModel(onStatus: (s: Status) => void, model: WhisperModel = "base") {
  const mine = (s: Status & { model?: WhisperModel }) => s.model === model && onStatus(s);
  statusListeners.add(mine);
  return new Promise<void>((resolve, reject) => {
    const done = (s: Status & { model?: WhisperModel }) => {
      if (s.model !== model) return;
      if (s.phase === "ready") (statusListeners.delete(done), resolve());
      if (s.phase === "error") (statusListeners.delete(done), reject(new Error(s.message)));
    };
    statusListeners.add(done);
    getWorker().postMessage({ type: "load", model });
  }).finally(() => statusListeners.delete(mine));
}

/** Frees a model's memory once it's no longer needed. */
export const unloadModel = (model: WhisperModel) => worker?.postMessage({ type: "unload", model });

// One utterance at a time, in order: the device can only do one at once anyway.
let queue: Promise<unknown> = Promise.resolve();
export let queued = 0;

export function transcribeLocal(audio: Float32Array, language: string, { model = "base" as WhisperModel, timestamps = false } = {}) {
  queued++;
  const job = queue.then(
    () =>
      new Promise<{ text: string; chunks?: Chunk[] }>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ type: "transcribe", id, model, audio, language, timestamps }, [audio.buffer]);
      }),
  );
  queue = job.catch(() => {});
  return job.finally(() => queued--);
}

/** Counts lines waiting on a cloud service too, so the page can say "transcribing 3…". */
async function tracked<T>(p: Promise<T>) {
  queued++;
  try {
    return await p;
  } finally {
    queued--;
  }
}

const TAP = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("haven-tap", Tap);
`;

/**
 * Cuts a continuous stream into utterances, using quiet stretches as boundaries.
 * What counts as quiet follows the stream's own background noise, so a soft-spoken meeting
 * isn't mistaken for silence and a noisy room isn't mistaken for speech.
 */
export class Segmenter {
  private frames: Float32Array[] = [];
  private lead: Float32Array[] = [];
  private partial = new Float32Array(0);
  private quiet = 0;
  private voiced = 0;
  private startSample = 0;
  private samples = 0;
  private floor = 0.003;

  constructor(
    private emit: (audio: Float32Array, startSec: number) => void,
    private limits = { minSeconds: 1.2, maxSeconds: 14 },
  ) {}

  push(chunk: Float32Array) {
    const merged = new Float32Array(this.partial.length + chunk.length);
    merged.set(this.partial);
    merged.set(chunk, this.partial.length);
    let i = 0;
    for (; i + FRAME <= merged.length; i += FRAME) this.frame(merged.slice(i, i + FRAME));
    this.partial = merged.slice(i);
  }

  private frame(f: Float32Array) {
    let sum = 0;
    for (const v of f) sum += v * v;
    const rms = Math.sqrt(sum / f.length);
    // The noise floor drops quickly and rises slowly, so speech itself barely moves it.
    this.floor = rms < this.floor ? 0.9 * this.floor + 0.1 * rms : 0.998 * this.floor + 0.002 * rms;
    const loud = rms > Math.max(0.006, this.floor * 3);
    if (!this.frames.length && !loud) {
      this.lead.push(f);
      if (this.lead.length > LEAD_IN_FRAMES) this.lead.shift();
      this.samples += f.length;
      return;
    }
    if (!this.frames.length) {
      this.startSample = this.samples - this.lead.length * FRAME;
      this.frames.push(...this.lead.splice(0));
    }
    this.frames.push(f);
    this.samples += f.length;
    if (loud) (this.voiced++, (this.quiet = 0));
    else this.quiet++;
    const seconds = (this.frames.length * FRAME) / RATE;
    if ((this.quiet >= PAUSE_FRAMES && seconds > this.limits.minSeconds) || seconds >= this.limits.maxSeconds) this.flush();
  }

  flush() {
    if (this.frames.length && this.voiced >= 4) {
      const audio = new Float32Array(this.frames.length * FRAME);
      this.frames.forEach((f, i) => audio.set(f, i * FRAME));
      this.emit(audio, Math.max(0, this.startSample) / RATE);
    }
    this.frames = [];
    this.quiet = 0;
    this.voiced = 0;
  }
}

export type CaptureLine = { at: number; text: string; speaker?: "You" | "Them"; clip?: string };

export class MeetingCapture {
  private ctx: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private segmenters: Segmenter[] = [];
  private stopped = false;
  /** The last few lines, given to the cloud service as context for names and spelling */
  private recent = "";
  private warned = false;

  constructor(
    private opts: {
      meetingId: string;
      /** BCP-47 language of the meeting, e.g. "fr-FR" */
      language: string;
      /** ms already recorded in this meeting, so timestamps continue */
      offset: number;
      /** Also capture the meeting's own sound (headphones mode); otherwise the microphone only */
      meetingAudio: boolean;
      onLine: (line: CaptureLine) => void;
      onEnded: (reason?: string) => void;
      /** Something worth telling you about that doesn't stop listening */
      onWarning?: (message: string) => void;
    },
  ) {}

  /** Transcribes one utterance: with the cloud service if there is one, else (or if it fails) on this device. */
  private async transcribe(audio: Float32Array, at: number, speaker: CaptureLine["speaker"]) {
    if (cloudStt()) {
      try {
        const text = await tracked(cloudTranscribe(audio, this.opts.language.slice(0, 2), this.recent));
        return { text };
      } catch (e) {
        if (!this.warned) (this.warned = true), this.opts.onWarning?.(`${(e as Error).message} Transcribing on this device for now.`);
      }
    }
    // Kept so the line can be redone with a bigger model after the meeting.
    const clip = uid();
    await saveClip({ id: clip, meetingId: this.opts.meetingId, at, speaker, pcm: toPcm(audio) }).catch(() => {});
    const { text } = await transcribeLocal(audio, whisperLanguage(this.opts.language));
    return { text, clip };
  }

  async start() {
    let display: MediaStream | null = null;
    let meetingTrack: MediaStreamTrack | null = null;
    if (this.opts.meetingAudio) {
      // The browser asks which tab or screen to share; the meeting's sound comes with it.
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
      meetingTrack = display.getAudioTracks()[0] ?? null;
      if (!meetingTrack) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error("No sound was shared. Share again and tick “Share tab audio” (or “Share system audio” for a whole screen).");
      }
      // Only the sound is needed; keep the video track but stop sending frames.
      display.getVideoTracks().forEach((t) => (t.enabled = false));
    }
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.streams = display ? [display, mic] : [mic];

    this.ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    silent.connect(this.ctx.destination);

    // Cloud services do better with whole sentences, and longer pieces cost nothing extra.
    const limits = cloudStt() ? { minSeconds: 4, maxSeconds: 25 } : { minSeconds: 1.2, maxSeconds: 14 };
    const wire = (stream: MediaStream, speaker: CaptureLine["speaker"]) => {
      const seg = new Segmenter(async (audio, startSec) => {
        const at = this.opts.offset + Math.round(startSec * 1000);
        try {
          const { text, clip } = await this.transcribe(audio, at, speaker);
          const clean = text.trim();
          if (clean && !PHANTOMS.test(clean)) {
            this.recent = `${this.recent} ${clean}`.slice(-600);
            this.opts.onLine({ at, text: clean, speaker, clip });
          }
        } catch {
          /* one failed utterance shouldn't stop the meeting */
        }
      }, limits);
      this.segmenters.push(seg);
      const node = new AudioWorkletNode(this.ctx!, "haven-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => seg.push(e.data);
      this.ctx!.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]])).connect(node);
      node.connect(silent);
    };
    if (display) {
      wire(display, "Them");
      wire(mic, "You");
    } else wire(mic, undefined); // microphone only: it hears the whole room, so no labels

    // Ending the share from the browser's own "Stop sharing" bar ends listening too.
    meetingTrack?.addEventListener("ended", () => {
      if (!this.stopped) {
        this.stop();
        this.opts.onEnded("Sharing stopped.");
      }
    });
  }

  stop() {
    this.stopped = true;
    this.segmenters.forEach((s) => s.flush());
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.ctx?.close();
    this.ctx = null;
  }
}

export const meetingCaptureSupported = () => !!navigator.mediaDevices?.getDisplayMedia && typeof AudioWorkletNode !== "undefined";
export const localMicSupported = () => !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
