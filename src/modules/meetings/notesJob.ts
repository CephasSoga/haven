import { create } from "zustand";
import { explain } from "@/lib/ai";
import { showNotice } from "@/lib/notices";
import { notify } from "@/lib/notify";
import { analyze } from "./agent";
import { queued } from "./capture";
import { useMeetings } from "./store";

/**
 * "Generate notes & actions" as a job of the app, not of the Meetings screen: it carries on when you
 * go elsewhere, the screen picks its progress back up when you return, and if you're not looking at
 * the meeting when it's done (or fails), a notice says so and takes you there.
 */

type Job = { running: boolean; step: string; error: string | null };
export const useNotesJobs = create<{ jobs: Record<string, Job> }>(() => ({ jobs: {} }));

const setJob = (id: string, patch: Partial<Job>) =>
  useNotesJobs.setState((s) => ({ jobs: { ...s.jobs, [id]: { ...(s.jobs[id] ?? { running: false, step: "", error: null }), ...patch } } }));

const open = (id: string) => () => {
  window.location.hash = `#/meetings?id=${id}`;
};

/** Whether that meeting is on screen right now (and the window is visible). */
const looking = (id: string) => !document.hidden && window.location.hash.startsWith("#/meetings") && new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("id") === id;

export async function generateNotes(meetingId: string) {
  if (useNotesJobs.getState().jobs[meetingId]?.running) return;
  setJob(meetingId, { running: true, step: "", error: null });
  const nameOf = () => {
    const m = useMeetings.getState().meetings.find((x) => x.id === meetingId);
    return m?.title || m?.analysis?.title || "your meeting";
  };
  try {
    // Let the last utterances finish transcribing first — on this device a long meeting can leave
    // many; keep waiting as long as they're moving, and give up after a minute without progress.
    let left = queued;
    let movedAt = Date.now();
    while (queued > 0 && Date.now() - movedAt < 60_000) {
      setJob(meetingId, { step: `finishing the transcript — ${queued} line${queued === 1 ? "" : "s"} left` });
      await new Promise((r) => setTimeout(r, 500));
      if (queued < left) (left = queued), (movedAt = Date.now());
    }
    setJob(meetingId, { step: "" });
    const meeting = useMeetings.getState().meetings.find((m) => m.id === meetingId);
    if (!meeting) return setJob(meetingId, { running: false });
    const analysis = await analyze(meeting, (step) => setJob(meetingId, { step }));
    // Deleted meanwhile: nothing to save it to.
    const now = useMeetings.getState().meetings.find((m) => m.id === meetingId);
    if (!now) return setJob(meetingId, { running: false });
    useMeetings.getState().update(meetingId, { analysis, title: now.title || analysis.title });
    setJob(meetingId, { running: false, step: "" });
    if (!looking(meetingId)) {
      showNotice({ id: `notes-${meetingId}`, tone: "info", title: "Meeting notes are ready", body: `${analysis.title}: summary, decisions and next steps.`, action: { label: "Open", run: open(meetingId) } });
      if (document.hidden) void notify("Meeting notes are ready", analysis.title);
    }
  } catch (e) {
    const error = explain(e);
    setJob(meetingId, { running: false, step: "", error });
    if (!looking(meetingId)) showNotice({ id: `notes-${meetingId}`, tone: "error", title: `Couldn't write the notes for ${nameOf()}`, body: error, action: { label: "Open", run: open(meetingId) } });
  }
}
