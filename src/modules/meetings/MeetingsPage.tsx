import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarPlus,
  Check,
  ChevronLeft,
  ClipboardPaste,
  FileText,
  Flag,
  Info,
  ListPlus,
  Mic,
  NotebookPen,
  Pause,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, Card, EmptyState, IconButton, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { explain, useAi } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { formatDuration, PRIORITIES } from "@/modules/calendar/store";
import { addEvent, addTask, analyze, todayLabel, writeNotesPage } from "./agent";
import { LANGUAGES, speechSupported, useSpeech } from "./speech";
import { clock, parseTranscript, useMeetings, type Meeting } from "./store";

export function MeetingsPage() {
  const { meetings, create, remove } = useMeetings();
  const [params, setParams] = useSearchParams();
  const selected = meetings.find((m) => m.id === params.get("id")) ?? null;
  const select = (id: string | null) => setParams(id ? { id } : {}, { replace: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Meetings"
        title="Meetings"
        actions={
          <Button variant="primary" onClick={() => select(create())}>
            <Plus className="size-4" /> New meeting
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className={cn("overflow-hidden lg:sticky lg:top-8 lg:block lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto", selected ? "hidden" : "block")}>
          {meetings.length === 0 ? (
            <EmptyState
              icon={<Mic className="size-5" />}
              title="No meetings yet"
              body="Start one when a call begins. Haven listens, then Claude turns it into notes, tasks and events."
              action={<Button onClick={() => select(create())}><Plus className="size-4" /> New meeting</Button>}
            />
          ) : (
            <ul className="p-2">
              {meetings.map((m) => (
                <li key={m.id}>
                  <button onClick={() => select(m.id)} className={cn("w-full rounded-2xl px-4 py-3 text-left transition-colors", m.id === selected?.id ? "bg-sunken" : "hover:bg-sunken/60")}>
                    <div className="truncate font-medium">{m.analysis?.title || m.title || "Untitled meeting"}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                      {format(m.startedAt, "MMM d, HH:mm")}
                      {(m.recorded > 0 || m.segments.length > 0) && <span>· {clock(m.recorded || (m.segments.at(-1)?.at ?? 0))}</span>}
                      {m.analysis && <Sparkles className="size-3 text-cal" />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={cn("min-w-0 lg:block", selected ? "block" : "hidden")}>
          {selected ? (
            <MeetingView
              key={selected.id}
              meeting={selected}
              onBack={() => select(null)}
              onDelete={() => {
                if (!confirm("Delete this meeting and its transcript? Tasks, events and pages you already added stay.")) return;
                remove(selected.id);
                select(null);
              }}
            />
          ) : (
            <Card className="flex min-h-[60dvh] flex-col items-center justify-center px-8 text-center">
              <div className="mb-5 flex size-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-[#e0555a] to-[#7c6cff] text-white shadow-card">
                <Mic className="size-7" />
              </div>
              <div className="font-serif text-3xl">Your meeting companion</div>
              <p className="mt-2 max-w-md text-[14px] text-muted">
                Start a meeting and let Haven listen. Afterwards, Claude writes the notes and proposes tasks and events — you choose what goes into your planner.
              </p>
              <Button variant="primary" className="mt-6" onClick={() => select(create())}>
                <Plus className="size-4" /> New meeting
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- One meeting ---------- */

function MeetingView({ meeting, onBack, onDelete }: { meeting: Meeting; onBack: () => void; onDelete: () => void }) {
  const { update, addSegment, setLanguage } = useMeetings();
  const hasKey = useAi((s) => !!s.apiKey.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(!meeting.analysis);
  const sessionStart = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const elapsed = () => meeting.recorded + (sessionStart.current ? Date.now() - sessionStart.current : 0);
  const speech = useSpeech(meeting.language, (text) => addSegment(meeting.id, { at: elapsed(), text }));

  useEffect(() => {
    if (!speech.listening) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [speech.listening]);

  useEffect(() => {
    if (speech.listening) bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [meeting.segments.length, speech.interim, speech.listening]);

  const toggle = () => {
    if (speech.listening) {
      update(meeting.id, { recorded: elapsed() });
      sessionStart.current = null;
      speech.stop();
    } else {
      if (!meeting.segments.length && meeting.recorded === 0) update(meeting.id, { startedAt: Date.now() });
      sessionStart.current = Date.now();
      speech.start();
    }
  };

  const run = async () => {
    if (speech.listening) toggle();
    setBusy(true);
    setError(null);
    try {
      const analysis = await analyze(useMeetings.getState().meetings.find((m) => m.id === meeting.id)!);
      update(meeting.id, { analysis, title: meeting.title || analysis.title });
      setShowTranscript(false);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    const segments = parseTranscript(await file.text());
    if (!segments.length) return setError("That file didn't contain a transcript Haven could read.");
    update(meeting.id, { segments: [...meeting.segments, ...segments], recorded: Math.max(meeting.recorded, segments.at(-1)!.at) });
  };

  void now; // re-render tick for the timer
  const a = meeting.analysis;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <IconButton label="Back" onClick={onBack} className="-ml-2 lg:hidden">
          <ChevronLeft className="size-5" />
        </IconButton>
        <input
          value={meeting.title}
          onChange={(e) => update(meeting.id, { title: e.target.value })}
          placeholder={a?.title || "Untitled meeting"}
          className="min-w-0 flex-1 bg-transparent font-serif text-[34px] leading-tight tracking-tight placeholder:text-faint focus:outline-none"
        />
        <IconButton label="Delete meeting" onClick={onDelete} className="hover:text-neg">
          <Trash2 className="size-[18px]" />
        </IconButton>
      </div>

      {/* Recorder */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <button
            onClick={toggle}
            aria-label={speech.listening ? "Pause listening" : "Start listening"}
            className={cn(
              "relative flex size-14 shrink-0 items-center justify-center rounded-full text-white shadow-card transition-transform active:scale-95",
              speech.listening ? "bg-neg" : "bg-primary text-on-primary",
            )}
          >
            {speech.listening && <motion.span className="absolute inset-0 rounded-full bg-neg" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />}
            {speech.listening ? <Pause className="relative size-6" /> : <Mic className="relative size-6" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-serif text-3xl leading-none tabular">{clock(elapsed())}</div>
            <div className="mt-1 text-[13px] text-muted">
              {speech.listening ? "Listening…" : meeting.segments.length ? `${meeting.segments.length} lines captured` : "Ready when you are"}
            </div>
          </div>
          <Select value={meeting.language} onChange={(e) => (update(meeting.id, { language: e.target.value }), setLanguage(e.target.value))} disabled={speech.listening} className="h-10 w-40 text-[13px]" aria-label="Language">
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
          <div className="flex gap-1">
            <IconButton label="Import transcript file (.vtt, .srt, .txt)" onClick={() => fileRef.current?.click()} className="border border-line">
              <Upload className="size-4" />
            </IconButton>
            <IconButton label="Paste a transcript" onClick={() => setPasting(true)} className="border border-line">
              <ClipboardPaste className="size-4" />
            </IconButton>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".vtt,.srt,.txt,text/vtt,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {(speech.error || !speechSupported()) && (
          <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-neg/10 px-3.5 py-2.5 text-[13px] text-neg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {speech.error ?? "Live transcription needs Chrome or Edge. You can still import or paste a transcript."}
          </div>
        )}

        {(meeting.segments.length > 0 || speech.listening) && (
          <div className="border-t border-line">
            {a && (
              <button onClick={() => setShowTranscript(!showTranscript)} className="w-full px-5 py-3 text-left text-[13px] font-medium text-muted hover:text-ink">
                {showTranscript ? "Hide transcript" : `Show transcript · ${meeting.segments.length} lines`}
              </button>
            )}
            {showTranscript && (
              <div className="max-h-80 overflow-y-auto px-5 pb-5 pt-2 text-[14px] leading-relaxed">
                {meeting.segments.map((s, i) => (
                  <div key={i} className="flex gap-3 py-0.5">
                    <span className="w-12 shrink-0 pt-px text-right text-[12px] text-faint tabular">{clock(s.at)}</span>
                    <span>
                      {s.speaker && <span className="font-medium">{s.speaker}: </span>}
                      {s.text}
                    </span>
                  </div>
                ))}
                {speech.interim && (
                  <div className="flex gap-3 py-0.5 text-faint">
                    <span className="w-12 shrink-0" />
                    <span>{speech.interim}</span>
                  </div>
                )}
                <div ref={bottom} />
              </div>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 border-t border-line bg-sunken/40 px-5 py-3 text-[12px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Haven listens through this device's microphone — on a video call, use speakers rather than headphones so the other side is heard too. Or import the transcript your meeting app saves (Zoom, Meet and Teams export .vtt files).
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2 text-[13px] font-medium text-muted">Your notes</div>
        <Textarea
          value={meeting.myNotes}
          onChange={(e) => update(meeting.id, { myNotes: e.target.value })}
          placeholder="Anything you want Claude to know — names, context, what matters to you…"
          className="min-h-24 border-0 bg-transparent px-0 shadow-none focus:ring-0"
        />
      </Card>

      {/* The agent */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" className="h-11 px-5" onClick={run} disabled={busy || !hasKey || (!meeting.segments.length && !meeting.myNotes.trim())}>
          <Sparkles className={cn("size-4", busy && "animate-pulse")} />
          {busy ? "Claude is reading the meeting…" : a ? "Regenerate notes & actions" : "Generate notes & actions"}
        </Button>
        {!hasKey && (
          <span className="text-[13px] text-muted">
            Needs an Anthropic API key —{" "}
            <Link to="/settings" className="font-medium text-cal hover:underline">
              add one in Settings
            </Link>
          </span>
        )}
        {a && <span className="text-[12px] text-faint">Generated {formatDistanceToNowStrict(a.generatedAt, { addSuffix: true })}</span>}
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-neg/10 px-4 py-3 text-[14px] text-neg">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </div>
      )}

      <AnimatePresence>{a && <Results meeting={meeting} />}</AnimatePresence>

      <PasteDialog
        open={pasting}
        onClose={() => setPasting(false)}
        onPaste={(text) => {
          const segments = parseTranscript(text);
          if (segments.length) update(meeting.id, { segments: [...meeting.segments, ...segments] });
        }}
      />
    </div>
  );
}

/* ---------- What the agent found ---------- */

function Section({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-1 pt-4">
        <span className="text-faint">{icon}</span>
        <h3 className="flex-1 text-[15px] font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      <div className="px-5 pb-5 pt-2">{children}</div>
    </Card>
  );
}

function Results({ meeting }: { meeting: Meeting }) {
  const a = meeting.analysis!;
  const mineLeft = useMemo(() => a.actionItems.map((x, i) => [x, i] as const).filter(([x]) => x.mine && !x.addedTaskId), [a]);
  const eventsLeft = a.events.map((e, i) => [e, i] as const).filter(([e]) => !e.addedEventId);

  const addAll = () => {
    for (const [, i] of mineLeft) addTask(useMeetings.getState().meetings.find((m) => m.id === meeting.id)!, i);
    for (const [, i] of eventsLeft) addEvent(useMeetings.getState().meetings.find((m) => m.id === meeting.id)!, i);
    if (!meeting.notesPageId) writeNotesPage(useMeetings.getState().meetings.find((m) => m.id === meeting.id)!);
  };
  const nothingLeft = !mineLeft.length && !eventsLeft.length && !!meeting.notesPageId;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, var(--cal-soft), transparent 70%)" }} />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-cal">
            <Sparkles className="size-3.5" /> Summary
          </div>
          <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
            {a.summary.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={addAll} disabled={nothingLeft}>
              <Check className="size-4" /> {nothingLeft ? "All added" : "Add my tasks, events & notes"}
            </Button>
            {meeting.notesPageId ? (
              <Link to={`/notes?id=${meeting.notesPageId}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium shadow-soft hover:border-line-strong">
                <NotebookPen className="size-4" /> Open the note
              </Link>
            ) : (
              <Button onClick={() => writeNotesPage(meeting)}>
                <FileText className="size-4" /> Save as a note
              </Button>
            )}
          </div>
        </div>
      </Card>

      {a.actionItems.length > 0 && (
        <Section title="Action items" icon={<ListPlus className="size-4" />}>
          <ul className="flex flex-col gap-1">
            {a.actionItems.map((x, i) => (
              <li key={i} className={cn("flex items-start gap-3 rounded-2xl px-3 py-2.5", x.mine ? "bg-sunken/50" : "")}>
                <Flag className="mt-1 size-3.5 shrink-0" style={{ color: PRIORITIES[x.priority].color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{x.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted">
                    <span className={x.mine ? "font-medium text-cal" : undefined}>{x.mine ? "You" : x.owner || "Unassigned"}</span>
                    <span>{formatDuration(x.duration)}</span>
                    {x.due && <span>Due {todayLabel(x.due)}</span>}
                  </div>
                </div>
                {x.addedTaskId ? (
                  <Link to="/calendar" className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-[12px] font-medium text-pos hover:bg-sunken">
                    <CalendarCheck className="size-3.5" /> Planned
                  </Link>
                ) : (
                  <Button size="sm" onClick={() => addTask(meeting, i)}>
                    <Plus className="size-3.5" /> Plan it
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {a.events.length > 0 && (
        <Section title="Scheduled in the meeting" icon={<CalendarPlus className="size-4" />}>
          <ul className="flex flex-col gap-1">
            {a.events.map((e, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
                <div className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-line py-1">
                  <span className="text-[10px] font-semibold uppercase text-cal">{format(new Date(`${e.date}T12:00`), "EEE")}</span>
                  <span className="font-serif text-lg leading-none">{format(new Date(`${e.date}T12:00`), "d")}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-[12px] text-muted">
                    {todayLabel(e.date)}
                    {e.start ? ` · ${e.start}${e.end ? `–${e.end}` : ""}` : " · all day"}
                    {e.location ? ` · ${e.location}` : ""}
                  </div>
                </div>
                {e.addedEventId ? (
                  <span className="flex items-center gap-1 px-2.5 text-[12px] font-medium text-pos">
                    <CalendarCheck className="size-3.5" /> Added
                  </span>
                ) : (
                  <Button size="sm" onClick={() => addEvent(meeting, i)}>
                    <Plus className="size-3.5" /> Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {a.decisions.length > 0 && (
          <Section title="Decisions" icon={<Check className="size-4" />}>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">
              {a.decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </Section>
        )}
        {a.questions.length > 0 && (
          <Section title="Open questions" icon={<Info className="size-4" />}>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">
              {a.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </motion.div>
  );
}

function PasteDialog({ open, onClose, onPaste }: { open: boolean; onClose: () => void; onPaste: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste a transcript"
      footer={
        <>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              onPaste(text);
              setText("");
              onClose();
            }}
          >
            Add to meeting
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[14px] text-muted">Plain text, or captions copied from Zoom, Meet or Teams. Lines like “Sam: …” keep the speaker’s name.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-[13px]" autoFocus />
    </Modal>
  );
}
