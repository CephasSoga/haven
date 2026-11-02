import { create } from "zustand";
import { aiReady } from "@/lib/ai";
import { correctTranscript } from "./agent";
import { PHANTOMS, prepareModel, transcribeLocal, unloadModel, whisperLanguage } from "./capture";
import { deleteClips, fromPcm, meetingClips, type Clip } from "./clips";
import { useMeetings, type Segment } from "./store";

/**
 * "Improve transcript", after a meeting:
 *   1. Lines transcribed on this device are redone from their saved audio with a bigger model.
 *      Pieces are joined into windows of up to 18 seconds per speaker — Whisper reads 30 seconds
 *      at a time whatever it's given, so fewer, fuller windows are quicker. (Measured: as accurate
 *      as redoing each line alone; at ~28 seconds it started skipping sentences.)
 *   2. Claude reads the whole transcript and fixes what was misheard (when there's an API key).
 */

type Step = "download" | "transcribe" | "correct";
type ImproveState = { meetingId: string | null; step: Step | null; done: number; total: number; progress: number; error: string | null };

export const useImprove = create<ImproveState>(() => ({ meetingId: null, step: null, done: 0, total: 0, progress: 0, error: null }));

const RATE = 16_000;
const WINDOW_SECONDS = 18;
const GAP = new Float32Array(RATE / 5); // 200 ms of silence between joined pieces

type Window = { clips: Clip[]; offsets: number[]; samples: number };

/** Groups each speaker's pieces, in order, into windows of up to 18 seconds. */
function windows(clips: Clip[]): Window[] {
  const out: Window[] = [];
  const open = new Map<string, Window>();
  for (const c of clips) {
    const who = c.speaker ?? "";
    let w = open.get(who);
    if (w && w.samples + GAP.length + c.pcm.length > WINDOW_SECONDS * RATE) w = undefined;
    if (!w) {
      w = { clips: [], offsets: [], samples: 0 };
      out.push(w);
      open.set(who, w);
    }
    if (w.clips.length) w.samples += GAP.length;
    w.offsets.push(w.samples);
    w.clips.push(c);
    w.samples += c.pcm.length;
  }
  return out;
}

function join(w: Window) {
  const audio = new Float32Array(w.samples);
  w.clips.forEach((c, i) => audio.set(fromPcm(c.pcm), w.offsets[i]));
  return audio;
}

/** Where a moment in the joined window falls in the meeting. */
function meetingTime(w: Window, seconds: number) {
  const sample = seconds * RATE;
  let i = 0;
  while (i + 1 < w.clips.length && w.offsets[i + 1] <= sample) i++;
  return w.clips[i].at + Math.max(0, Math.round(((sample - w.offsets[i]) / RATE) * 1000));
}

function replaceLines(meetingId: string, clipIds: Set<string>, lines: Segment[]) {
  const { meetings, update } = useMeetings.getState();
  const m = meetings.find((x) => x.id === meetingId);
  if (!m) return;
  const kept = m.segments.filter((s) => !s.clip || !clipIds.has(s.clip));
  update(meetingId, { segments: [...kept, ...lines].sort((a, b) => a.at - b.at) });
}

export async function improveTranscript(meetingId: string) {
  const set = useImprove.setState;
  set({ meetingId, step: null, done: 0, total: 0, progress: 0, error: null });
  try {
    const clips = await meetingClips(meetingId);
    if (clips.length) {
      set({ step: "download" });
      await prepareModel((s) => s.phase === "loading" && set({ progress: s.progress }), "small");
      const ws = windows(clips);
      const language = whisperLanguage(useMeetings.getState().meetings.find((m) => m.id === meetingId)?.language ?? "en");
      set({ step: "transcribe", total: ws.length, done: 0 });
      for (const w of ws) {
        const { text, chunks } = await transcribeLocal(join(w), language, { model: "small", timestamps: true });
        const speaker = w.clips[0].speaker;
        const pieces = chunks?.length ? chunks : [{ text, timestamp: [0, null] as [number, number | null] }];
        const lines = pieces
          .map((p) => ({ at: meetingTime(w, p.timestamp[0] ?? 0), text: p.text.trim(), speaker }))
          .filter((l) => l.text && !PHANTOMS.test(l.text));
        // Each window is saved as soon as it's done, so stopping halfway keeps what was improved.
        const ids = new Set(w.clips.map((c) => c.id));
        replaceLines(meetingId, ids, lines);
        await deleteClips([...ids]);
        set((s) => ({ done: s.done + 1 }));
      }
      unloadModel("small");
    }
    if (aiReady()) {
      set({ step: "correct" });
      const m = useMeetings.getState().meetings.find((x) => x.id === meetingId);
      if (m?.segments.length) useMeetings.getState().update(meetingId, { segments: await correctTranscript(m) });
    }
    set({ meetingId: null, step: null });
  } catch (e) {
    set({ step: null, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
