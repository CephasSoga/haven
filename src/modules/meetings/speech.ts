import { useEffect, useRef, useState } from "react";

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

export const speechSupported = () => !!ctor();

export function useSpeech(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;

  const start = () => {
    const Ctor = ctor();
    if (!Ctor) return setError("Live transcription needs Chrome or Edge. You can still import or paste a transcript.");
    setError(null);
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const text = res[0].transcript.trim();
          if (text) final.current(text);
        } else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted.current = false;
        setError("Microphone access was blocked. Allow it in the browser's site settings, then try again.");
      } else if (e.error === "network") {
        setError("The speech service couldn't be reached. Check your connection.");
      }
    };
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
        } catch {
          /* already restarting */
        }
      } else {
        setListening(false);
        setInterim("");
      }
    };
    wanted.current = true;
    rec.current = r;
    r.start();
    setListening(true);
  };

  const stop = () => {
    wanted.current = false;
    rec.current?.stop();
    setListening(false);
    setInterim("");
  };

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { listening, interim, error, start, stop };
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
