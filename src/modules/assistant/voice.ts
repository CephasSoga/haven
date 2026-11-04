import { cloudStt, cloudTranscribe } from "@/modules/meetings/stt";
import { prepareModel, transcribeLocal, whisperLanguage } from "@/modules/meetings/capture";
import { useMeetings } from "@/modules/meetings/store";

/**
 * Speaking to the assistant: records the microphone until you stop, then turns the speech into
 * text — with the transcription service set up in Settings (OpenAI or Groq), or else on this device.
 * The text goes into the message box, so you can check it before sending.
 */

const RATE = 16_000;
const TAP = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("haven-voice-tap", Tap);
`;

export class VoiceNote {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private chunks: Float32Array[] = [];

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(this.ctx, "haven-voice-tap");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.ctx.createMediaStreamSource(this.stream).connect(node);
    node.connect(silent);
    silent.connect(this.ctx.destination);
  }

  /** Stops recording and returns what was said. */
  async stop(onStatus?: (s: string) => void) {
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    const audio = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) (audio.set(c, at), (at += c.length));
    this.chunks = [];
    if (audio.length < RATE / 2) return "";
    const language = useMeetings.getState().language;
    if (cloudStt()) {
      onStatus?.("Transcribing…");
      try {
        return await cloudTranscribe(audio, language.slice(0, 2));
      } catch {
        /* fall back to this device */
      }
    }
    onStatus?.("Preparing the speech model…");
    await prepareModel((s) => s.phase === "loading" && onStatus?.(`Downloading the speech model — ${Math.round(s.progress)}% (one time only)`));
    onStatus?.("Transcribing…");
    const { text } = await transcribeLocal(audio, whisperLanguage(language));
    return text.trim();
  }

  cancel() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.chunks = [];
  }
}

export const voiceSupported = () => !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
