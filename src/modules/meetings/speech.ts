import { inApp } from "@/lib/platform";

/**
 * Live transcription with the browser's built-in speech recognition (Chrome and Edge).
 * Recognition stops by itself after silence; while you're "listening" we quietly restart it.
 * Note: in Chrome and Edge, the browser sends the audio to its own speech service to transcribe it.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// Inside the installed apps the system web view has no speech service; on-device Whisper is used instead.
export const speechSupported = () => !inApp && !!ctor();

/**
 * Listens with the browser's speech recognition until stopped. It isn't tied to any screen, so a
 * meeting keeps being transcribed while you use the rest of Haven.
 */
export class BrowserSpeech {
  private rec: Recognition | null = null;
  private wanted = false;

  constructor(
    private opts: {
      lang: string;
      onFinal: (text: string) => void;
      onInterim: (text: string) => void;
      /** Something went wrong; `fatal` means listening has stopped for good */
      onError: (message: string, fatal: boolean) => void;
      /** Listening ended (stopped by you, or after a fatal error) */
      onEnd: () => void;
    },
  ) {}

  /** Returns false when listening couldn't even begin. */
  start(): boolean {
    const Ctor = ctor();
    if (!Ctor) {
      this.opts.onError("Live transcription needs Chrome or Edge. You can still import or paste a transcript.", true);
      return false;
    }
    const r = new Ctor();
    r.lang = this.opts.lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const text = res[0].transcript.trim();
          if (text) this.opts.onFinal(text);
        } else pending += res[0].transcript;
      }
      this.opts.onInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.wanted = false;
        this.opts.onError("Microphone access was blocked. Allow it in the browser's site settings, then try again.", true);
      } else if (e.error === "network") {
        this.opts.onError("The speech service couldn't be reached. Check your connection.", false);
      }
    };
    // Recognition stops by itself after silence; while you're "listening" it's quietly restarted.
    r.onend = () => {
      if (this.wanted) {
        try {
          r.start();
        } catch {
          /* already restarting */
        }
      } else {
        this.opts.onInterim("");
        this.opts.onEnd();
      }
    };
    this.wanted = true;
    this.rec = r;
    try {
      r.start();
    } catch {
      this.wanted = false;
      this.opts.onError("Live transcription couldn't start. Reload the page and try again.", true);
      return false;
    }
    return true;
  }

  stop() {
    this.wanted = false;
    this.rec?.stop();
  }
}

export const LANGUAGES = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["fr-FR", "Français"],
  ["es-ES", "Español"],
  ["de-DE", "Deutsch"],
  ["pt-PT", "Português"],
  ["it-IT", "Italiano"],
  ["nl-NL", "Nederlands"],
] as const;
