import { addDays, format } from "date-fns";
import { AiError, baseRequest, client } from "@/lib/ai";
import { dayKey } from "@/lib/dates";
import { useSettings } from "@/store/settings";
import { expandEvents, fromMinutes, PRIORITIES, TASK_TYPES, toMinutes, useCalendar, type Priority } from "@/modules/calendar/store";
import { newTaskDraft } from "@/modules/calendar/TaskDialog";
import { useNotes } from "@/modules/notes/store";
import { clock, transcriptText, useMeetings, type Analysis, type Meeting } from "./store";

/* ---------- Reading the meeting ---------- */

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "decisions", "action_items", "events", "open_questions"],
  properties: {
    title: { type: "string", description: "A short, specific title for the meeting" },
    summary: { type: "string", description: "What was discussed and concluded, in 2-4 short paragraphs separated by blank lines" },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "owner", "mine", "due", "duration_minutes", "priority", "type"],
        properties: {
          title: { type: "string", description: "Starts with a verb, e.g. 'Send the revised budget to Sam'" },
          owner: { ...nullable("string"), description: "Who committed to it, if said" },
          mine: { type: "boolean", description: "True if the person recording the meeting owns it" },
          due: { ...nullable("string"), description: "YYYY-MM-DD if a deadline was stated or clearly implied, else null" },
          duration_minutes: { type: "integer", description: "Realistic focused time to do it" },
          priority: { type: "string", enum: Object.keys(PRIORITIES) },
          type: { type: "string", enum: Object.keys(TASK_TYPES) },
        },
      },
    },
    events: {
      type: "array",
      description: "Meetings, calls or appointments that were explicitly scheduled during the conversation",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "start", "end", "location", "notes"],
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          start: { ...nullable("string"), description: "HH:mm 24-hour, null if not stated" },
          end: { ...nullable("string"), description: "HH:mm 24-hour, null if not stated" },
          location: nullable("string"),
          notes: nullable("string"),
        },
      },
    },
    open_questions: { type: "array", items: { type: "string" }, description: "Unresolved questions or things to follow up on" },
  },
};

const SYSTEM = `You turn meeting transcripts into clear notes and next steps for one person: the one who recorded the meeting.

- Work only from what was said. Never invent people, numbers, dates or commitments. If something is ambiguous, leave it out or put it under open questions.
- Transcripts come from speech recognition and may contain errors, missing punctuation and no speaker names. Read for meaning. When lines are labelled "You" and "Them", "You" is the recorder and "Them" is everyone else on the call.
- Action items: concrete commitments to do something. Mark "mine" when the recorder committed to it ("I'll…", "let me…", or their name). Include others' commitments too, with their owner.
- Resolve relative dates ("Friday", "next week", "end of the month") against the meeting date. Use null when no deadline was given.
- Events: only meetings or appointments that were actually scheduled, with a date. Don't create events for vague intentions ("we should meet sometime").
- Write the summary in the language the meeting was held in, in calm, plain prose.`;

export async function analyze(meeting: Meeting): Promise<Analysis> {
  if (!meeting.segments.length && !meeting.myNotes.trim()) throw new AiError("There's nothing to read yet — record or import a transcript first.");
  const name = useSettings.getState().name.trim();
  const start = new Date(meeting.startedAt);
  const { events } = useCalendar.getState();
  const upcoming = [...expandEvents(events, Array.from({ length: 21 }, (_, i) => addDays(start, i))).values()]
    .flat()
    .map((e) => `- ${e.date} ${e.start ? `${e.start}-${e.end ?? ""}` : "all day"}: ${e.title}`)
    .join("\n");

  const user = [
    `Meeting date: ${format(start, "EEEE d MMMM yyyy, HH:mm")}`,
    `Length: ${clock(meeting.recorded || (meeting.segments.at(-1)?.at ?? 0))}`,
    meeting.title && `Title so far: ${meeting.title}`,
    `The recorder: ${name || "the user (name unknown)"}`,
    upcoming && `Their calendar for the next three weeks (to avoid duplicating events):\n${upcoming}`,
    meeting.myNotes.trim() && `Their own notes:\n${meeting.myNotes.trim()}`,
    `Transcript:\n${transcriptText(meeting.segments) || "(no transcript — work from the notes)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Streaming keeps long transcripts clear of request timeouts.
  const res = await client()
    .beta.messages.stream({
      ...baseRequest(),
      max_tokens: 16000,
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    })
    .finalMessage();

  if (res.stop_reason === "refusal") throw new AiError("Claude declined to process this transcript.");
  if (res.stop_reason === "max_tokens") throw new AiError("The meeting was too long to summarise in one go.");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let raw: {
    title: string;
    summary: string;
    decisions: string[];
    action_items: { title: string; owner: string | null; mine: boolean; due: string | null; duration_minutes: number; priority: Priority; type: string }[];
    events: { title: string; date: string; start: string | null; end: string | null; location: string | null; notes: string | null }[];
    open_questions: string[];
  };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AiError("Claude's answer couldn't be read. Try again.");
  }

  const isDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const isTime = (t: string | null) => !!t && /^\d{2}:\d{2}$/.test(t);
  return {
    title: raw.title,
    summary: raw.summary,
    decisions: raw.decisions,
    actionItems: raw.action_items.map((a) => ({
      title: a.title,
      owner: a.owner,
      mine: a.mine,
      due: isDate(a.due) ? a.due : null,
      duration: Math.min(480, Math.max(10, Math.round(a.duration_minutes / 5) * 5 || 30)),
      priority: a.priority in PRIORITIES ? a.priority : "medium",
      type: a.type in TASK_TYPES ? a.type : "admin",
    })),
    events: raw.events
      .filter((e) => isDate(e.date))
      .map((e) => ({
        title: e.title,
        date: e.date,
        start: isTime(e.start) ? e.start : null,
        end: isTime(e.end) ? e.end : isTime(e.start) ? fromMinutes(toMinutes(e.start!) + 30) : null,
        location: e.location,
        notes: e.notes,
      })),
    questions: raw.open_questions,
    generatedAt: Date.now(),
  };
}

/* ---------- Acting on it ---------- */

export function addTask(meeting: Meeting, index: number) {
  const a = meeting.analysis!.actionItems[index];
  const id = useCalendar.getState().saveTask(
    newTaskDraft({
      title: a.title,
      duration: a.duration,
      priority: a.priority,
      type: a.type,
      deadline: a.due ?? undefined,
      notes: `From the meeting “${meeting.analysis!.title}” on ${format(meeting.startedAt, "MMM d")}${a.owner && !a.mine ? ` — owner: ${a.owner}` : ""}`,
    }),
  );
  useMeetings.getState().patchAction(meeting.id, index, { addedTaskId: id });
}

export function addEvent(meeting: Meeting, index: number) {
  const e = meeting.analysis!.events[index];
  const before = new Set(useCalendar.getState().events.map((x) => x.id));
  useCalendar.getState().save({
    title: e.title,
    date: e.date,
    start: e.start ?? undefined,
    end: e.start ? (e.end ?? undefined) : undefined,
    color: "blue",
    location: e.location ?? undefined,
    notes: [e.notes, `Planned in “${meeting.analysis!.title}”`].filter(Boolean).join("\n"),
  });
  const id = useCalendar.getState().events.find((x) => !before.has(x.id))?.id;
  useMeetings.getState().patchEvent(meeting.id, index, { addedEventId: id ?? "added" });
}

/** Writes the meeting up as a note, tagged #meeting. */
export function writeNotesPage(meeting: Meeting) {
  const a = meeting.analysis!;
  const section = (title: string, lines: string[]) => (lines.length ? ["", title, ...lines] : []);
  const body = [
    `${format(meeting.startedAt, "EEEE d MMMM yyyy, HH:mm")} · ${clock(meeting.recorded || (meeting.segments.at(-1)?.at ?? 0))}`,
    "",
    a.summary.trim(),
    ...section("Decisions", a.decisions.map((d) => `- ${d}`)),
    ...section(
      "Action items",
      a.actionItems.map((x) => `[ ] ${x.title}${x.owner ? ` — ${x.owner}` : ""}${x.due ? ` (by ${x.due})` : ""}`),
    ),
    ...section("Open questions", a.questions.map((q) => `- ${q}`)),
    ...section("My notes", meeting.myNotes.trim() ? [meeting.myNotes.trim()] : []),
    ...section("Transcript", meeting.segments.length ? [transcriptText(meeting.segments)] : []),
    "",
    "#meeting",
  ].join("\n");
  const id = useNotes.getState().create({ title: a.title, body, color: "rose" });
  useMeetings.getState().update(meeting.id, { notesPageId: id });
  return id;
}

export function todayLabel(date: string) {
  return date === dayKey(new Date()) ? "Today" : format(new Date(`${date}T12:00`), "EEE, MMM d");
}
