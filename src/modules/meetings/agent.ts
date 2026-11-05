import { addDays, format } from "date-fns";
import { AiError, askJson, estimateTokens, inPieces, tokenBudget } from "@/lib/ai";
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

export async function analyze(meeting: Meeting, onStep?: (step: string) => void): Promise<Analysis> {
  if (!meeting.segments.length && !meeting.myNotes.trim()) throw new AiError("There's nothing to read yet — record or import a transcript first.");
  const name = useSettings.getState().name.trim();
  const start = new Date(meeting.startedAt);
  const { events } = useCalendar.getState();
  const upcoming = [...expandEvents(events, Array.from({ length: 21 }, (_, i) => addDays(start, i))).values()]
    .flat()
    .map((e) => `- ${e.date} ${e.start ? `${e.start}-${e.end ?? ""}` : "all day"}: ${e.title}`)
    .join("\n");

  const intro = [
    `Meeting date: ${format(start, "EEEE d MMMM yyyy, HH:mm")}`,
    `Length: ${clock(meeting.recorded || (meeting.segments.at(-1)?.at ?? 0))}`,
    meeting.title && `Title so far: ${meeting.title}`,
    `The recorder: ${name || "the user (name unknown)"}`,
    upcoming && `Their calendar for the next three weeks (to avoid duplicating events):\n${upcoming}`,
    meeting.myNotes.trim() && `Their own notes:\n${meeting.myNotes.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = transcriptText(meeting.segments);
  // Room for the notes themselves: about 5,000 tokens on a small plan, more on bigger ones.
  const answerRoom = Math.min(16000, Math.max(2500, Math.round(tokenBudget() * 0.35)));
  const fits = estimateTokens(SYSTEM + intro + transcript) + answerRoom + 600 <= tokenBudget();
  const body = !transcript
    ? "Transcript: (no transcript — work from the notes)"
    : fits
      ? `Transcript:\n${transcript}`
      : `The transcript was too long to read at once, so it was condensed part by part. Condensed notes, in order:\n\n${await condense(meeting, onStep)}`;
  const user = `${intro}\n\n${body}`;

  const raw = await askJson<{
    title: string;
    summary: string;
    decisions: string[];
    action_items: { title: string; owner: string | null; mine: boolean; due: string | null; duration_minutes: number; priority: Priority; type: string }[];
    events: { title: string; date: string; start: string | null; end: string | null; location: string | null; notes: string | null }[];
    open_questions: string[];
  }>({ name: "meeting_notes", system: SYSTEM, user, schema: SCHEMA, effort: "high", maxTokens: answerRoom });

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

/* ---------- Correcting the transcript ---------- */

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fixes"],
  properties: {
    fixes: {
      type: "array",
      description: "Only the lines that need changing",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line", "text"],
        properties: {
          line: { type: "integer", description: "The line's number, as given" },
          text: { type: "string", description: "The corrected line; an empty string removes a line that is only noise" },
        },
      },
    },
  },
};

const FIX_SYSTEM = `You correct transcripts made by speech recognition, which mishears words — especially names, numbers, technical terms and non-English speech, where it often writes sounds as nonsense words.

- Restore what was actually said, using the surrounding lines, the meeting's language and the recorder's notes (which often contain the right names). For example, French heard as "Say tune bonne idée, on lame et en plaste" is "C'est une bonne idée, on la met en place".
- Fix spelling, capitalisation and punctuation. Keep the speaker's own words and language — never translate, summarise, shorten or add content.
- Keep each line separate: never merge lines, split them or move text between them.
- When a line is only noise the recogniser invented (e.g. "Thank you for watching", "Sous-titres réalisés par…") and fits nothing around it, return it as an empty string.
- When you can't tell what was said, leave the line as it is.
- Return only the lines you changed.`;

/** Asks Claude to correct speech-recognition errors line by line; returns the corrected lines (empty ones removed). */
export async function correctTranscript(meeting: Meeting, onStep?: (step: string) => void): Promise<Meeting["segments"]> {
  const segments = meeting.segments;
  if (!segments.length) return segments;
  const language = LANGUAGE_NAMES[meeting.language.slice(0, 2)] ?? meeting.language;
  const intro = [`The meeting was held in ${language}.`, meeting.myNotes.trim() && `The recorder's notes:\n${meeting.myNotes.trim()}`].filter(Boolean).join("\n\n");
  const line = (i: number) => `${i + 1}. ${segments[i].speaker ? `${segments[i].speaker}: ` : ""}${segments[i].text}`;
  // Corrections can be as long as the lines themselves, so each piece leaves the same again for the answer.
  const room = Math.max(800, Math.floor((tokenBudget() - estimateTokens(FIX_SYSTEM + intro) - 1200) / 2.3));
  const pieces = inPieces(
    segments.map((_, i) => i),
    line,
    room,
  );
  const fixes: { line: number; text: string }[] = [];
  for (const [n, piece] of pieces.entries()) {
    onStep?.(pieces.length > 1 ? `part ${n + 1} of ${pieces.length}` : "");
    // A few lines before each piece, for context; only the piece's own lines are corrected.
    const before = piece[0] > 0 ? `For context, the lines just before:\n${Array.from({ length: Math.min(3, piece[0]) }, (_, k) => line(piece[0] - Math.min(3, piece[0]) + k)).join("\n")}\n\n` : "";
    const answer = await askJson<{ fixes: { line: number; text: string }[] }>({
      name: "transcript_fixes",
      system: FIX_SYSTEM,
      user: `${intro}\n\n${before}${pieces.length > 1 ? `Lines ${piece[0] + 1}–${piece.at(-1)! + 1} of ${segments.length}` : "Transcript"}, one numbered line per utterance:\n${piece.map(line).join("\n")}`,
      schema: FIX_SCHEMA,
      effort: "medium",
      // Groq's models stop at about 65,000 tokens of answer; Haven caps the request there.
      maxTokens: Math.min(64000, Math.max(1500, Math.round(room * 1.3))),
    });
    fixes.push(...answer.fixes.filter((f) => f.line - 1 >= piece[0] && f.line - 1 <= piece.at(-1)!));
  }
  const out = segments.map((s) => ({ ...s }));
  for (const f of fixes) {
    const s = out[f.line - 1];
    if (!s) continue;
    // Claude sometimes repeats the speaker label it was shown; it's kept separately.
    s.text = s.speaker ? f.text.replace(new RegExp(`^${s.speaker}:\\s*`), "") : f.text;
  }
  return out.filter((s) => s.text.trim());
}

const CONDENSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes"],
  properties: { notes: { type: "string", description: "Detailed notes of this part of the meeting" } },
};

const CONDENSE_SYSTEM = `You condense one part of a long meeting transcript into detailed notes, so the whole meeting can be read later from the notes alone.

- Keep everything that matters: topics, what each person said or proposed, decisions, commitments (who will do what, by when), dates, times, numbers, names and open questions.
- Keep the speaker labels ("You" is the recorder, "Them" the others) and the order things happened in.
- Drop small talk and repetition. Write in the language of the meeting. Never add anything that wasn't said.`;

/** A transcript too long to read at once, as notes condensed piece by piece, in order. */
async function condense(meeting: Meeting, onStep?: (step: string) => void) {
  const lines = transcriptText(meeting.segments).split("\n");
  const room = Math.max(1000, Math.floor((tokenBudget() - estimateTokens(CONDENSE_SYSTEM) - 1500) * 0.6));
  const pieces = inPieces(lines, (l) => l, room);
  const notes: string[] = [];
  for (const [n, piece] of pieces.entries()) {
    onStep?.(`reading part ${n + 1} of ${pieces.length}`);
    const { notes: part } = await askJson<{ notes: string }>({
      name: "meeting_part",
      system: CONDENSE_SYSTEM,
      user: `Part ${n + 1} of ${pieces.length} of the transcript:\n${piece.join("\n")}`,
      schema: CONDENSE_SCHEMA,
      effort: "low",
      maxTokens: Math.max(1000, Math.round(room * 0.5)),
    });
    notes.push(`Part ${n + 1}:\n${part.trim()}`);
  }
  onStep?.("writing the notes");
  return notes.join("\n\n");
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
};

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
