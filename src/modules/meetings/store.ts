import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import type { Priority } from "@/modules/calendar/store";

export type Segment = {
  /** Milliseconds since the meeting started */
  at: number;
  text: string;
  speaker?: string;
};

export type ActionItem = {
  title: string;
  owner: string | null;
  /** Whether it's yours to do */
  mine: boolean;
  /** yyyy-MM-dd */
  due: string | null;
  duration: number;
  priority: Priority;
  type: string;
  addedTaskId?: string;
};

export type ProposedEvent = {
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  location: string | null;
  notes: string | null;
  addedEventId?: string;
};

export type Analysis = {
  title: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  events: ProposedEvent[];
  questions: string[];
  generatedAt: number;
};

export type Meeting = {
  id: string;
  title: string;
  startedAt: number;
  /** Total time spent recording, in ms */
  recorded: number;
  language: string;
  segments: Segment[];
  myNotes: string;
  analysis?: Analysis;
  notesPageId?: string;
};

type MeetingsState = {
  meetings: Meeting[];
  language: string;
  create: (patch?: Partial<Meeting>) => string;
  update: (id: string, patch: Partial<Meeting>) => void;
  addSegment: (id: string, seg: Segment) => void;
  patchAction: (id: string, index: number, patch: Partial<ActionItem>) => void;
  patchEvent: (id: string, index: number, patch: Partial<ProposedEvent>) => void;
  remove: (id: string) => void;
  setLanguage: (lang: string) => void;
  replaceAll: (meetings: Meeting[]) => void;
};

export const useMeetings = create<MeetingsState>()(
  persist(
    (set, get) => ({
      meetings: [],
      language: navigator.language || "en-US",
      create: (patch) => {
        const m: Meeting = { id: uid(), title: "", startedAt: Date.now(), recorded: 0, language: get().language, segments: [], myNotes: "", ...patch };
        set((s) => ({ meetings: [m, ...s.meetings] }));
        return m.id;
      },
      update: (id, patch) => set((s) => ({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      addSegment: (id, seg) => set((s) => ({ meetings: s.meetings.map((m) => (m.id === id ? { ...m, segments: [...m.segments, seg] } : m)) })),
      patchAction: (id, index, patch) =>
        set((s) => ({
          meetings: s.meetings.map((m) =>
            m.id === id && m.analysis ? { ...m, analysis: { ...m.analysis, actionItems: m.analysis.actionItems.map((a, i) => (i === index ? { ...a, ...patch } : a)) } } : m,
          ),
        })),
      patchEvent: (id, index, patch) =>
        set((s) => ({
          meetings: s.meetings.map((m) =>
            m.id === id && m.analysis ? { ...m, analysis: { ...m.analysis, events: m.analysis.events.map((e, i) => (i === index ? { ...e, ...patch } : e)) } } : m,
          ),
        })),
      remove: (id) => set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) })),
      setLanguage: (language) => set({ language }),
      replaceAll: (meetings) => set({ meetings }),
    }),
    { name: "haven:meetings", version: 1 },
  ),
);

export function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function transcriptText(segments: Segment[]) {
  return segments.map((s) => `[${clock(s.at)}] ${s.speaker ? `${s.speaker}: ` : ""}${s.text}`).join("\n");
}

/** Reads WebVTT / SRT captions (Zoom, Meet, Teams exports) or plain text into segments. */
export function parseTranscript(raw: string): Segment[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const stamp = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,]\d{1,3}\s*-->/;
  if (!lines.some((l) => stamp.test(l))) {
    return raw
      .split(/\n{1,}/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, i) => {
        const who = text.match(/^([^:]{1,40}):\s+(.*)$/);
        return { at: i * 5000, text: who ? who[2] : text, speaker: who ? who[1] : undefined };
      });
  }
  const out: Segment[] = [];
  let at = 0;
  for (const line of lines) {
    const m = line.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->/);
    if (m) {
      at = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
      continue;
    }
    const t = line.trim();
    if (!t || t === "WEBVTT" || /^\d+$/.test(t) || /^(NOTE|STYLE|Kind:|Language:)/.test(t)) continue;
    const voice = t.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
    const who = !voice && t.match(/^([^:]{1,40}):\s+(.*)$/);
    const text = (voice ? voice[2] : who ? who[2] : t).replace(/<[^>]+>/g, "").trim();
    const speaker = voice ? voice[1].trim() : who ? who[1] : undefined;
    const prev = out[out.length - 1];
    // Captions split sentences across cues; join consecutive lines from the same speaker.
    if (prev && prev.speaker === speaker && at - prev.at < 15_000 && prev.text.length < 400) prev.text += ` ${text}`;
    else out.push({ at, text, speaker });
  }
  return out;
}
