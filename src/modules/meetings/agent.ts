import { addDays, format } from "date-fns";
import { AiError, AiTimeout, AiTooBig, AiTooLong, askJson, estimateTokens, inPieces, tokenBudget, worthRetrying } from "@/lib/ai";
import { dayKey } from "@/lib/dates";
import { useSettings } from "@/store/settings";
import { expandEvents, fromMinutes, PRIORITIES, taskTypes, toMinutes, useCalendar, type Priority } from "@/modules/calendar/store";
import { newTaskDraft } from "@/modules/calendar/TaskDialog";
import { useNotes } from "@/modules/notes/store";
import { clock, isFiller, transcriptText, useMeetings, type Analysis, type Meeting } from "./store";

/* ---------- Long meetings ---------- */

/**
 * Anthropic and OpenAI could take a whole long meeting in one request, but one request that has to
 * read (or rewrite) an hour of talk is slow enough to time out and can run out of room for its
 * answer. So long work goes in parts of bounded size, a few at a time, each retried once.
 */
const roomy = () => tokenBudget() > 50_000;
/** Groq paces requests to its per-minute allowance anyway, so its parts go one after another. */
const atOnce = () => (roomy() ? 3 : 1);
/** About 10 minutes of speech: a part's corrections come back in well under a minute. */
const FIX_PART_TOKENS = 2_500;
/** About 40 minutes of speech per condensed part. */
const CONDENSE_PART_TOKENS = 10_000;
/** Past about two hours, the meeting is read part by part even when it would fit in one request. */
const ONE_PASS_TOKENS = 30_000;

/** Runs `fn` over the items, at most `limit` at a time, keeping the results in order. */
async function inParallel<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Tries once more when a part fails for a reason that may pass (a timeout, a dropped connection, a busy server). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!worthRetrying(e)) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return fn();
  }
}

/* ---------- Reading the meeting ---------- */

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

/** Built when asking, so the task types include the ones you added. */
const schema = () => ({
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
          type: { type: "string", enum: Object.keys(taskTypes()) },
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
});

const SYSTEM = `You turn meeting transcripts into clear notes and next steps for one person: the one who recorded the meeting.

- Work only from what was said. Never invent people, numbers, dates or commitments. If something is ambiguous, leave it out or put it under open questions.
- Transcripts come from speech recognition and may contain errors, missing punctuation and no speaker names. Read for meaning. When lines are labelled "You" and "Them", "You" is the recorder and "Them" is everyone else on the call.
- Action items: concrete commitments to do something. Mark "mine" when the recorder committed to it ("I'll…", "let me…", or their name). Include others' commitments too, with their owner.
- Resolve relative dates ("Friday", "next week", "end of the month") against the meeting date. Use null when no deadline was given.
- Events: only meetings or appointments that were actually scheduled, with a date. Don't create events for vague intentions ("we should meet sometime").
- Write everything (title, summary, decisions, action items, events and open questions) in the meeting's language, which is given with the meeting. The summary is calm, plain prose.`;

export async function analyze(meeting: Meeting, onStep?: (step: string) => void): Promise<Analysis> {
  if (!meeting.segments.length && !meeting.myNotes.trim()) throw new AiError("There's nothing to read yet — record or import a transcript first.");
  const name = useSettings.getState().name.trim();
  const start = new Date(meeting.startedAt);
  const { events } = useCalendar.getState();
  const upcoming = [...expandEvents(events, Array.from({ length: 21 }, (_, i) => addDays(start, i))).values()]
    .flat()
    .map((e) => `- ${e.date} ${e.start ? `${e.start}-${e.end ?? ""}` : "all day"}: ${e.title}`)
    .join("\n");

  const language = languageName(meeting.language);
  const intro = [
    `Meeting date: ${format(start, "EEEE d MMMM yyyy, HH:mm")}`,
    `Language: ${language} (chosen for the transcript). Write all of your answer in ${language}.`,
    `Length: ${clock(meeting.recorded || (meeting.segments.at(-1)?.at ?? 0))}`,
    meeting.title && `Title so far: ${meeting.title}`,
    `The recorder: ${name || "the user (name unknown)"}`,
    upcoming && `Their calendar for the next three weeks (to avoid duplicating events):\n${upcoming}`,
    meeting.myNotes.trim() && `Their own notes:\n${meeting.myNotes.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = transcriptText(meeting.segments);
  const size = estimateTokens(transcript);
  // Room for the answer, thinking included: about 5,000 tokens on a small Groq plan, 32,000 elsewhere.
  const answerRoom = roomy() ? 32_000 : Math.min(16000, Math.max(2500, Math.round(tokenBudget() * 0.35)));
  const fits = size <= ONE_PASS_TOKENS && estimateTokens(SYSTEM + intro + transcript) + answerRoom + 600 <= tokenBudget();
  // The condensed notes must fit beside everything else in the final request (on a small Groq plan, 8,000 tokens in all).
  const notesRoom = Math.min(
    ONE_PASS_TOKENS,
    Math.floor((tokenBudget() - estimateTokens(SYSTEM + intro + JSON.stringify(schema())) - answerRoom - 700) * 0.8),
  );
  const condensedIntro = "The transcript was too long to read at once, so it was condensed part by part. Condensed notes, in order:\n\n";
  /** Reads the condensed notes; if the service still finds them too big (it counts words its own way), shortens them further. */
  const fromNotes = async () => {
    let target = Math.max(800, notesRoom);
    let parts = await condense(transcriptText(meeting.segments).split("\n"), "transcript", target, language, onStep);
    for (let tries = 0; ; tries++) {
      try {
        return await ask(condensedIntro + parts.join("\n\n"));
      } catch (e) {
        if (!(e instanceof AiTooBig) || tries >= 2) throw e;
        // Make it as much shorter as the service says it's over, and a little more.
        const over = e.reading - (e.limit - answerRoom - 300);
        target = Math.max(500, Math.floor((estimateTokens(parts.join("\n\n")) - over * 1.2) * 0.9));
        parts = await condense(parts, "notes", target, language, onStep);
      }
    }
  };

  type Raw = {
    title: string;
    summary: string;
    decisions: string[];
    action_items: { title: string; owner: string | null; mine: boolean; due: string | null; duration_minutes: number; priority: Priority; type: string }[];
    events: { title: string; date: string; start: string | null; end: string | null; location: string | null; notes: string | null }[];
    open_questions: string[];
  };
  const ask = (body: string, { long = false } = {}) =>
    askJson<Raw>({
      name: "meeting_notes",
      system: SYSTEM,
      user: `${intro}\n\n${body}`,
      schema: schema(),
      // A long meeting read whole thinks a little less, so the answer comes in time.
      effort: long ? "medium" : "high",
      maxTokens: answerRoom,
      // Less than this and the notes won't fit; better to send shorter condensed notes.
      minAnswer: Math.round(answerRoom * 0.8),
      // More to read takes longer: 4 minutes, plus about 2 more per hour of meeting, at most 10.
      timeoutMs: Math.min(600_000, 240_000 + size * 10),
    });

  let raw: Raw;
  if (!transcript) raw = await ask("Transcript: (no transcript — work from the notes)");
  else if (!fits) raw = await fromNotes();
  else {
    try {
      raw = await withRetry(() => ask(`Transcript:\n${transcript}`, { long: size > 12_000 }));
    } catch (e) {
      // Too slow, or too long for one answer: read it part by part instead.
      if (!(e instanceof AiTimeout || e instanceof AiTooLong || e instanceof AiTooBig) || size < 3_000) throw e;
      onStep?.("reading it in parts instead");
      raw = await fromNotes();
    }
  }

  const isDate = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const isTime = (t: string | null | undefined): t is string => !!t && /^\d{2}:\d{2}$/.test(t);
  // An answer recovered from a format check can miss a field; nothing missing should break the page.
  const list = <T,>(v: T[] | undefined | null) => (Array.isArray(v) ? v : []);
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: text(raw.title) || meeting.title || "Meeting notes",
    summary: text(raw.summary),
    decisions: list(raw.decisions).filter((d) => typeof d === "string"),
    actionItems: list(raw.action_items)
      .filter((a) => a && text(a.title))
      .map((a) => ({
      title: a.title,
      owner: a.owner ?? null,
      mine: !!a.mine,
      due: isDate(a.due) ? a.due : null,
      duration: Math.min(480, Math.max(10, Math.round(a.duration_minutes / 5) * 5 || 30)),
      priority: a.priority in PRIORITIES ? a.priority : "medium",
      type: a.type in taskTypes() ? a.type : "admin",
    })),
    events: list(raw.events)
      .filter((e) => e && isDate(e.date) && text(e.title))
      .map((e) => ({
        title: e.title,
        date: e.date,
        start: isTime(e.start) ? e.start : null,
        end: isTime(e.end) ? e.end : isTime(e.start) ? fromMinutes(toMinutes(e.start!) + 30) : null,
        location: e.location ?? null,
        notes: e.notes ?? null,
      })),
    questions: list(raw.open_questions).filter((q) => typeof q === "string"),
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

/**
 * Asks the AI to correct speech-recognition errors line by line, in parts of about ten minutes.
 * Returns the corrected lines (empty ones removed) and the parts that couldn't be corrected, which
 * are left as they were — one bad part doesn't undo the rest.
 */
export async function correctTranscript(meeting: Meeting, onStep?: (step: string) => void): Promise<{ segments: Meeting["segments"]; skipped: number[]; parts: number }> {
  const segments = meeting.segments;
  if (!segments.length) return { segments, skipped: [], parts: 0 };
  const language = languageName(meeting.language);
  const intro = [`The meeting was held in ${language}.`, meeting.myNotes.trim() && `The recorder's notes:\n${meeting.myNotes.trim()}`].filter(Boolean).join("\n\n");
  const line = (i: number) => `${i + 1}. ${segments[i].speaker ? `${segments[i].speaker}: ` : ""}${segments[i].text}`;
  // Corrections can be as long as the lines themselves, so each piece leaves the same again for the answer.
  const room = Math.min(FIX_PART_TOKENS, Math.max(800, Math.floor((tokenBudget() - estimateTokens(FIX_SYSTEM + intro) - 1200) / 2.3)));
  // Lines with no words ("…", silence) aren't worth sending; they keep their numbers, and go.
  const pieces = inPieces(
    segments.map((_, i) => i).filter((i) => !isFiller(segments[i].text)),
    line,
    room,
  );
  if (!pieces.length) return { segments: segments.filter((s) => !isFiller(s.text)), skipped: [], parts: 0 };
  const skipped: number[] = [];
  let lastError: unknown;
  let done = 0;
  const progress = () => onStep?.(pieces.length > 1 ? `${done} of ${pieces.length} parts done` : "");
  progress();
  const results = await inParallel(pieces, atOnce(), async (piece, n) => {
    // A few lines before each piece, for context; only the piece's own lines are corrected.
    const before = piece[0] > 0 ? `For context, the lines just before:\n${Array.from({ length: Math.min(3, piece[0]) }, (_, k) => line(piece[0] - Math.min(3, piece[0]) + k)).join("\n")}\n\n` : "";
    try {
      const answer = await withRetry(() =>
        askJson<{ fixes: { line: number; text: string }[] }>({
          name: "transcript_fixes",
          system: FIX_SYSTEM,
          user: `${intro}\n\n${before}${pieces.length > 1 ? `Lines ${piece[0] + 1}–${piece.at(-1)! + 1} of ${segments.length}` : "Transcript"}, one numbered line per utterance:\n${piece.map(line).join("\n")}`,
          schema: FIX_SCHEMA,
          effort: "medium",
          // The corrections, plus room to think (which counts against the answer with Claude and OpenAI).
          maxTokens: Math.max(1500, Math.round(room * 1.3)) + (roomy() ? 6000 : 0),
        }),
      );
      return answer.fixes.filter((f) => f.line - 1 >= piece[0] && f.line - 1 <= piece.at(-1)!);
    } catch (e) {
      // A wrong key or a stop ends everything; anything else just leaves this part as it was.
      if (!worthRetrying(e) && !(e instanceof AiTooLong)) throw e;
      skipped.push(n + 1);
      lastError = e;
      return [];
    } finally {
      done++;
      progress();
    }
  });
  if (skipped.length === pieces.length) throw lastError;
  const fixes = results.flat();
  const out = segments.map((s) => ({ ...s }));
  for (const f of fixes) {
    const s = out[f.line - 1];
    if (!s) continue;
    // Claude sometimes repeats the speaker label it was shown; it's kept separately.
    s.text = s.speaker ? f.text.replace(new RegExp(`^${s.speaker}:\\s*`), "") : f.text;
  }
  return { segments: out.filter((s) => s.text.trim() && !isFiller(s.text)), skipped: skipped.sort((a, b) => a - b), parts: pieces.length };
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

/**
 * A transcript too long to read at once, as notes condensed piece by piece, in order, in about `target` tokens
 * all told. Each part gets its share of that; if the notes still come out too long (a very long meeting on a small
 * plan), the notes themselves are condensed again.
 */
async function condense(blocks: string[], kind: "transcript" | "notes", target: number, language: string, onStep?: (step: string) => void) {
  const room = Math.min(CONDENSE_PART_TOKENS, Math.max(1000, Math.floor((tokenBudget() - estimateTokens(CONDENSE_SYSTEM) - 1500) * 0.6)));
  for (let round = kind === "notes" ? 1 : 0; ; round++) {
    const pieces = inPieces(blocks, (l) => l, room);
    // Each part's share, in words (a word is a token or two, more in French than in English).
    const share = Math.max(250, Math.floor(target / pieces.length));
    const words = Math.max(120, Math.round(share * 0.55));
    const what = round ? "notes" : "transcript";
    let done = 0;
    onStep?.(round ? `shortening the notes (${pieces.length} parts)` : `reading ${pieces.length} parts`);
    /** Notes for some lines; when the notes don't fit in one answer, the lines go in two halves instead. */
    const notesFor = async (lines: string[], label: string, limit: number, depth = 0): Promise<string> => {
      try {
        const { notes: part } = await withRetry(() =>
          askJson<{ notes: string }>({
            name: "meeting_part",
            system: CONDENSE_SYSTEM,
            user: `${label} of the ${what}. The meeting is in ${language}: write your notes in ${language}, under ${limit} words.\n\n${lines.join("\n")}`,
            schema: CONDENSE_SCHEMA,
            effort: "low",
            maxTokens: Math.max(1000, Math.round(room * 0.5)) + (roomy() ? 4000 : 0),
          }),
        );
        return part.trim();
      } catch (e) {
        if (!(e instanceof AiTooLong) || depth >= 3 || lines.length < 4) throw e;
        const half = Math.ceil(lines.length / 2);
        const each = Math.max(80, Math.round(limit / 2));
        return `${await notesFor(lines.slice(0, half), `${label} (first half)`, each, depth + 1)}\n${await notesFor(lines.slice(half), `${label} (second half)`, each, depth + 1)}`;
      }
    };
    const notes = await inParallel(pieces, atOnce(), async (piece, n) => {
      const part = await notesFor(piece, `Part ${n + 1} of ${pieces.length}`, words);
      done++;
      onStep?.(round ? `shortened ${done} of ${pieces.length}` : `read ${done} of ${pieces.length} parts`);
      return `Part ${n + 1}:\n${part}`;
    });
    // Short enough to read in one go, or as short as it will get.
    if (estimateTokens(notes.join("\n\n")) <= target || round >= 3 || notes.length < 2) {
      onStep?.("writing the notes");
      return notes;
    }
    blocks = notes;
  }
}

/** "fr-FR" → "French": the language picked for the meeting's transcript, by name. */
export function languageName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code.slice(0, 2)) ?? code;
  } catch {
    return code;
  }
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

/** The meeting's notes as plain text, for pasting into an email or a chat. */
export function summaryText(meeting: Meeting) {
  const a = meeting.analysis!;
  const section = (title: string, lines: string[]) => (lines.length ? ["", title, ...lines] : []);
  return [
    a.title,
    `${format(meeting.startedAt, "EEEE d MMMM yyyy, HH:mm")} · ${clock(meeting.recorded || (meeting.segments.at(-1)?.at ?? 0))}`,
    "",
    a.summary.trim(),
    ...section("Decisions", a.decisions.map((d) => `- ${d}`)),
    ...section(
      "Action items",
      a.actionItems.map((x) => `- ${x.title}${x.owner ? ` — ${x.owner}` : x.mine ? " — me" : ""}${x.due ? ` (by ${x.due})` : ""}`),
    ),
    ...section(
      "Scheduled",
      a.events.map((e) => `- ${e.title}: ${e.date}${e.start ? ` ${e.start}${e.end ? `–${e.end}` : ""}` : ""}${e.location ? `, ${e.location}` : ""}`),
    ),
    ...section("Open questions", a.questions.map((q) => `- ${q}`)),
  ].join("\n");
}

/** Copies text, with an older fallback for web views without the clipboard API. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
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
