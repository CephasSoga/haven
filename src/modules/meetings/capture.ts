/**
 * "Headphones mode": records your microphone and the meeting's own audio (a shared tab, or the
 * whole system's sound) as two separate streams, cuts them into utterances at pauses, and
 * transcribes each with Whisper running locally. Keeping the streams apart is what lets the
 * transcript say who spoke: "You" (microphone) or "Them" (the meeting).
 */

const RATE = 16_000;
const FRAME = RATE / 10; // 100 ms
const SPEECH_RMS = 0.012;
const MAX_SECONDS = 14;
const PAUSE_FRAMES = 7; // 700 ms of quiet ends an utterance

const WHISPER_LANG: Record<string, string> = {
  en: "english",
  fr: "french",
  es: "spanish",
  de: "german",
  pt: "portuguese",
  it: "italian",
  nl: "dutch",
};

// Whisper sometimes "hears" these in near-silence; drop them when they're all there is.
const PHANTOMS = /^(thank you\.?|thanks for watching!?|you|bye\.?|merci\.?|sous-titres.*|subtitles by.*|\[.*\]|\(.*\)|\.+)$/i;

type Status = { phase: "loading"; progress: number } | { phase: "ready"; device: string } | { phase: "listening" } | { phase: "error"; message: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
const statusListeners = new Set<(s: Status) => void>();
const progressByFile = new Map<string, number>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      progressByFile.set(m.file, m.progress);
      const values = [...progressByFile.values()];
      const progress = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
      statusListeners.forEach((l) => l({ phase: "loading", progress }));
    } else if (m.type === "ready") {
      statusListeners.forEach((l) => l({ phase: "ready", device: m.device }));
    } else if (m.type === "result") {
      pending.get(m.id)?.resolve(m.text);
      pending.delete(m.id);
    } else if (m.type === "error") {
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!.reject(new Error(m.message));
        pending.delete(m.id);
      } else statusListeners.forEach((l) => l({ phase: "error", message: m.message }));
    }
  };
  return worker;
}

/** Downloads (first time) and warms up the speech model. */
export function prepareModel(onStatus: (s: Status) => void) {
  statusListeners.add(onStatus);
  return new Promise<void>((resolve, reject) => {
    const done = (s: Status) => {
      if (s.phase === "ready") (statusListeners.delete(done), resolve());
      if (s.phase === "error") (statusListeners.delete(done), reject(new Error(s.message)));
    };
    statusListeners.add(done);
    getWorker().postMessage({ type: "load" });
  }).finally(() => statusListeners.delete(onStatus));
}

// One utterance at a time, in order, so the transcript reads naturally.
let queue: Promise<unknown> = Promise.resolve();
export let queued = 0;

function transcribe(audio: Float32Array, language: string): Promise<string> {
  queued++;
  const job = queue.then(
    () =>
      new Promise<string>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ type: "transcribe", id, audio, language }, [audio.buffer]);
      }),
  );
  queue = job.catch(() => {});
  return job.finally(() => queued--);
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

/** Cuts a continuous stream into utterances, using quiet stretches as boundaries. */
class Segmenter {
  private frames: Float32Array[] = [];
  private partial = new Float32Array(0);
  private quiet = 0;
  private voiced = 0;
  private startSample = 0;
  private samples = 0;

  constructor(private emit: (audio: Float32Array, startSec: number) => void) {}

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
    const loud = Math.sqrt(sum / f.length) > SPEECH_RMS;
    if (!this.frames.length && !loud) {
      this.samples += f.length; // skip leading silence
      return;
    }
    if (!this.frames.length) this.startSample = this.samples;
    this.frames.push(f);
    this.samples += f.length;
    if (loud) (this.voiced++, (this.quiet = 0));
    else this.quiet++;
    const seconds = (this.frames.length * FRAME) / RATE;
    if ((this.quiet >= PAUSE_FRAMES && seconds > 1.2) || seconds >= MAX_SECONDS) this.flush();
  }

  flush() {
    if (this.frames.length && this.voiced >= 4) {
      const audio = new Float32Array(this.frames.length * FRAME);
      this.frames.forEach((f, i) => audio.set(f, i * FRAME));
      this.emit(audio, this.startSample / RATE);
    }
    this.frames = [];
    this.quiet = 0;
    this.voiced = 0;
  }
}

export type CaptureLine = { at: number; text: string; speaker?: "You" | "Them" };

export class MeetingCapture {
  private ctx: AudioContext | null = null;
  private streams: MediaStream[] = [];
  private segmenters: Segmenter[] = [];
  private stopped = false;

  constructor(
    private opts: {
      /** BCP-47 language of the meeting, e.g. "fr-FR" */
      language: string;
      /** ms already recorded in this meeting, so timestamps continue */
      offset: number;
      /** Also capture the meeting's own sound (headphones mode); otherwise the microphone only */
      meetingAudio: boolean;
      onLine: (line: CaptureLine) => void;
      onEnded: (reason?: string) => void;
    },
  ) {}

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

    const lang = WHISPER_LANG[this.opts.language.slice(0, 2)] ?? "english";
    const wire = (stream: MediaStream, speaker: CaptureLine["speaker"]) => {
      const seg = new Segmenter(async (audio, startSec) => {
        try {
          const text = (await transcribe(audio, lang)).trim();
          if (text && !PHANTOMS.test(text)) this.opts.onLine({ at: this.opts.offset + Math.round(startSec * 1000), text, speaker });
        } catch {
          /* one failed utterance shouldn't stop the meeting */
        }
      });
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
