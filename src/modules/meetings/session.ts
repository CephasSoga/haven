import { create } from "zustand";
import { MeetingCapture, prepareModel, queued } from "./capture";
import { BrowserSpeech, speechSupported } from "./speech";
import { cloudStt } from "./stt";
import { useMeetings, type Meeting } from "./store";

/**
 * The meeting being recorded right now. It belongs to the app, not to the Meetings screen, so
 * recording and transcription carry on while you look at your calendar or notes — the pill at the
 * top of the screen shows it and stops it. One meeting is recorded at a time.
 */

type RecordingState = {
  meetingId: string | null;
  /** When this stretch of recording started (ms); the meeting's `recorded` holds earlier ones */
  since: number | null;
  /** What's happening while it starts ("Preparing the speech model…") */
  starting: string | null;
  /** Words heard but not settled yet (browser speech recognition only) */
  interim: string;
  /** The latest problem, for the meeting it happened to */
  error: { meetingId: string; text: string } | null;
};

export const useRecording = create<RecordingState>(() => ({ meetingId: null, since: null, starting: null, interim: "", error: null }));

let capture: MeetingCapture | null = null;
let speech: BrowserSpeech | null = null;

const meetingById = (id: string) => useMeetings.getState().meetings.find((m) => m.id === id);

/** How long a meeting has been recorded, counting the stretch in progress. */
export function elapsedFor(meeting: Pick<Meeting, "id" | "recorded">) {
  const { meetingId, since } = useRecording.getState();
  return meeting.recorded + (meetingId === meeting.id && since ? Date.now() - since : 0);
}

/** Lines still being transcribed. */
export const backlog = () => queued;

const setError = (meetingId: string, text: string | null) => useRecording.setState({ error: text ? { meetingId, text } : null });

/**
 * Ends the recording in progress, adding its time to the meeting. A stretch that ended in an error
 * before anything was heard doesn't count.
 */
export function stopRecording({ countTime = true } = {}) {
  const { meetingId, since } = useRecording.getState();
  if (meetingId && since && countTime) {
    const m = meetingById(meetingId);
    if (m) useMeetings.getState().update(meetingId, { recorded: m.recorded + (Date.now() - since) });
  }
  capture?.stop();
  capture = null;
  const s = speech;
  speech = null;
  s?.stop();
  useRecording.setState({ meetingId: null, since: null, starting: null, interim: "" });
}

/** Starts recording a meeting, in the mode chosen on the Meetings screen. */
export async function startRecording(meetingId: string) {
  if (useRecording.getState().meetingId) stopRecording();
  const meeting = meetingById(meetingId);
  if (!meeting) return;
  const { update, addSegment, mode } = useMeetings.getState();
  if (!meeting.segments.length && meeting.recorded === 0) update(meetingId, { startedAt: Date.now() });
  setError(meetingId, null);

  // Microphone mode uses the browser's speech service where there is one (Chrome, Edge) unless a
  // transcription service is set up; the installed apps and other browsers transcribe on this device.
  if (mode === "mic" && speechSupported() && !cloudStt()) {
    const s = new BrowserSpeech({
      lang: meeting.language,
      onFinal: (text) => addSegment(meetingId, { at: elapsedFor(meetingById(meetingId) ?? meeting), text }),
      onInterim: (interim) => useRecording.setState({ interim }),
      onError: (text, fatal) => {
        setError(meetingId, text);
        if (fatal && speech === s) stopRecording({ countTime: false });
      },
      // Recognition ended without being asked to (device unplugged…): close the session too.
      onEnd: () => speech === s && stopRecording(),
    });
    speech = s;
    useRecording.setState({ meetingId, since: Date.now() });
    if (!s.start()) {
      speech = null;
      useRecording.setState({ meetingId: null, since: null });
    }
    return;
  }

  useRecording.setState({ meetingId, starting: "Starting…" });
  try {
    if (!cloudStt()) {
      useRecording.setState({ starting: "Preparing the speech model…" });
      await prepareModel((s) => s.phase === "loading" && useRecording.setState({ starting: `Downloading the speech model — ${Math.round(s.progress)}% (one time only)` }));
    }
    useRecording.setState({ starting: mode === "meeting" ? "Choose the meeting to listen to…" : "Starting the microphone…" });
    const c = new MeetingCapture({
      meetingId,
      language: meeting.language,
      offset: meeting.recorded,
      meetingAudio: mode === "meeting",
      onLine: (line) => addSegment(meetingId, line),
      onEnded: (reason) => {
        if (capture !== c) return;
        stopRecording();
        if (reason) setError(meetingId, `${reason} Press the button to listen again.`);
      },
      onWarning: (text) => setError(meetingId, text),
    });
    await c.start();
    // Stopped (or another meeting started) while the browser was asking what to share.
    if (useRecording.getState().meetingId !== meetingId) return c.stop();
    capture = c;
    useRecording.setState({ since: Date.now(), starting: null });
  } catch (e) {
    const err = e as Error;
    useRecording.setState({ meetingId: null, since: null, starting: null });
    setError(meetingId, err.name === "NotAllowedError" ? "Sharing or microphone access was cancelled." : err.message);
  }
}
