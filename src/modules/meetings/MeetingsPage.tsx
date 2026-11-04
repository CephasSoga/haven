import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ask } from "@/components/confirm";
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
  Headphones,
  Info,
  ListPlus,
  Mic,
  NotebookPen,
  Pause,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { Button, Card, EmptyState, IconButton, Modal, PageHeader, Segmented, Select, Textarea } from "@/components/ui";
import { explain, useAiReady, useAssistant } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { formatDuration, PRIORITIES } from "@/modules/calendar/store";
import { addEvent, addTask, analyze, todayLabel, writeNotesPage } from "./agent";
import { LANGUAGES, speechSupported, useSpeech } from "./speech";
import { localMicSupported, MeetingCapture, meetingCaptureSupported, prepareModel, queued } from "./capture";
import { countClips, deleteMeetingClips } from "./clips";
import { improveTranscript, useImprove } from "./improve";
import { cloudStt, STT_PROVIDERS, useCloudStt } from "./stt";
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
              body="Start one when a call begins. Haven listens, then AI turns it into notes, tasks and events."
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
              onDelete={async () => {
                if (!(await ask({ title: "Delete this meeting?", body: "Its transcript and notes go too. Tasks, events and notes you already added stay where they are.", confirmLabel: "Delete", danger: true }))) return;
                remove(selected.id);
                void deleteMeetingClips(selected.id);
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
                Start a meeting and let Haven listen. Afterwards, AI writes the notes and proposes tasks and events — you choose what goes into your planner.
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
  const { update, addSegment, setLanguage, mode, setMode } = useMeetings();
  const hasKey = useAiReady();
  const ai = useAssistant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(!meeting.analysis);
  const sessionStart = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Headphones mode: microphone + shared meeting audio, transcribed locally.
  const capture = useRef<MeetingCapture | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [backlog, setBacklog] = useState(0);
  const cloudProvider = useCloudStt();

  const elapsed = () => meeting.recorded + (sessionStart.current ? Date.now() - sessionStart.current : 0);
  const speech = useSpeech(meeting.language, (text) => addSegment(meeting.id, { at: elapsed(), text }));
  const listening = speech.listening || capturing;

  // Speech recognition can stop on its own (microphone blocked, device unplugged, network).
  // Close the session then too, so the clock never keeps counting while nothing is listening;
  // a session that failed with an error doesn't count as recorded time.
  const wasListening = useRef(false);
  useEffect(() => {
    if (speech.listening) {
      wasListening.current = true;
      return;
    }
    if (!wasListening.current) return;
    wasListening.current = false;
    if (sessionStart.current && !capture.current) {
      if (!speech.error) update(meeting.id, { recorded: elapsed() });
      sessionStart.current = null;
    }
    // Only react to listening starting or stopping.
  }, [speech.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!listening && !backlog) return;
    const t = setInterval(() => {
      setNow(Date.now());
      setBacklog(queued);
    }, 500);
    return () => clearInterval(t);
  }, [listening, backlog]);

  useEffect(() => {
    if (listening) bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [meeting.segments.length, speech.interim, listening]);

  // Leaving the meeting (or the page) stops listening.
  useEffect(() => () => capture.current?.stop(), []);

  const pause = () => {
    update(meeting.id, { recorded: elapsed() });
    sessionStart.current = null;
    if (capture.current) {
      capture.current.stop();
      capture.current = null;
      setCapturing(false);
      setBacklog(queued);
    } else speech.stop();
  };

  const toggle = async () => {
    if (listening) return pause();
    if (!meeting.segments.length && meeting.recorded === 0) update(meeting.id, { startedAt: Date.now() });
    // Microphone mode uses the browser's speech service where there is one (Chrome, Edge) unless a
    // transcription service is set up; the installed apps and other browsers transcribe on this device.
    if (mode === "mic" && speechSupported() && !cloudStt()) {
      sessionStart.current = Date.now();
      if (!speech.start()) sessionStart.current = null;
      return;
    }
    setCaptureError(null);
    try {
      if (!cloudStt()) {
        setStarting("Preparing the speech model…");
        await prepareModel((s) => s.phase === "loading" && setStarting(`Downloading the speech model — ${Math.round(s.progress)}% (one time only)`));
      }
      setStarting(mode === "meeting" ? "Choose the meeting to listen to…" : "Starting the microphone…");
      const c = new MeetingCapture({
        meetingId: meeting.id,
        language: meeting.language,
        offset: meeting.recorded,
        meetingAudio: mode === "meeting",
        onLine: (line) => addSegment(meeting.id, line),
        onEnded: (reason) => {
          pause();
          if (reason) setCaptureError(`${reason} Press the button to listen again.`);
        },
        onWarning: setCaptureError,
      });
      await c.start();
      capture.current = c;
      sessionStart.current = Date.now();
      setCapturing(true);
    } catch (e) {
      const err = e as Error;
      setCaptureError(err.name === "NotAllowedError" ? "Sharing or microphone access was cancelled." : err.message);
    } finally {
      setStarting(null);
    }
  };

  const run = async () => {
    if (listening) pause();
    setBusy(true);
    setError(null);
    try {
      // Let the last few utterances finish transcribing first.
      for (let i = 0; queued > 0 && i < 240; i++) await new Promise((r) => setTimeout(r, 250));
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
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <Segmented
            layoutId={`capture-${meeting.id}`}
            value={mode}
            onChange={(m) => !listening && setMode(m)}
            options={[
              { value: "mic", label: <><Mic className="size-3.5" /> Microphone</> },
              { value: "meeting", label: <><Headphones className="size-3.5" /> Headphones</> },
            ]}
          />
          <span className="text-[12px] text-muted">
            {mode === "mic"
              ? "Hears everyone in the room. On a call, use speakers so the other side is picked up."
              : "Hears you and the meeting's own sound — works with headphones. Labels who spoke."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <button
            onClick={toggle}
            disabled={!!starting}
            aria-label={listening ? "Pause listening" : "Start listening"}
            className={cn(
              "relative flex size-14 shrink-0 items-center justify-center rounded-full text-white shadow-card transition-transform active:scale-95 disabled:opacity-60",
              listening ? "bg-neg" : "bg-primary text-on-primary",
            )}
          >
            {listening && <motion.span className="absolute inset-0 rounded-full bg-neg" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.4, repeat: Infinity }} />}
            {listening ? <Pause className="relative size-6" /> : mode === "meeting" ? <Headphones className="relative size-6" /> : <Mic className="relative size-6" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-serif text-3xl leading-none tabular">{clock(listening ? elapsed() : meeting.recorded)}</div>
            <div className="mt-1 text-[13px] text-muted">
              {starting ??
                (capturing
                  ? mode === "meeting"
                    ? "Listening to you and the meeting…"
                    : "Listening…"
                  : speech.listening
                    ? "Listening…"
                    : meeting.segments.length
                      ? `${meeting.segments.length} lines captured`
                      : "Ready when you are")}
              {backlog > 0 && <span className="ml-2 text-faint">· transcribing {backlog}…</span>}
            </div>
          </div>
          <Select value={meeting.language} onChange={(e) => (update(meeting.id, { language: e.target.value }), setLanguage(e.target.value))} disabled={listening} className="h-10 w-40 text-[13px]" aria-label="Language">
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

        {(() => {
          const problem =
            mode === "meeting"
              ? (captureError ?? (!meetingCaptureSupported() ? "Listening to meeting audio needs Chrome or Edge on a computer. You can still import or paste a transcript." : null))
              : (speech.error ?? captureError ?? (!speechSupported() && !localMicSupported() ? "This browser can't record audio. You can still import or paste a transcript." : null));
          return (
            problem && (
              <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-neg/10 px-3.5 py-2.5 text-[13px] text-neg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {problem}
              </div>
            )
          );
        })()}

        {(meeting.segments.length > 0 || listening) && (
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
                      {s.speaker && <span className={cn("font-medium", s.speaker === "You" ? "text-cal" : s.speaker === "Them" ? "text-[#c0583f]" : undefined)}>{s.speaker}: </span>}
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

        {!listening && !starting && meeting.segments.length > 0 && <ImproveRow meeting={meeting} hasKey={hasKey} />}

        <div className="flex items-start gap-2 border-t border-line bg-sunken/40 px-5 py-3 text-[12px] leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {cloudProvider ? (
            <span>
              Transcribed by {STT_PROVIDERS.find((p) => p.id === cloudProvider)?.label.split(" (")[0]} with your API key, chosen in Settings — the audio of each
              sentence is sent to them. If they can't be reached, Haven transcribes on this device instead.
              {mode === "meeting" && " When you start, the browser asks what to share: pick the meeting's tab (keep “Share tab audio” on), or for the Zoom or Teams app, “Entire screen” with “Share system audio”."}
            </span>
          ) : mode === "mic" ? (
            speechSupported() ? (
              <span>
                Microphone mode uses the browser's speech recognition (in Chrome and Edge, the audio is transcribed by the browser's speech service). You can also import
                the transcript your meeting app saves — Zoom, Meet and Teams export .vtt files.
              </span>
            ) : (
              <span>
                Microphone mode transcribes on this device with an open-source speech model (a one-time download of about 80 MB); nothing is sent anywhere. You can also
                import the transcript your meeting app saves — Zoom, Meet and Teams export .vtt files.
              </span>
            )
          ) : (
            <span>
              When you start, the browser asks what to share. For Meet or Teams in the browser, pick the meeting's tab and keep “Share tab audio” on. For the Zoom or Teams
              app, pick “Entire screen” and turn on “Share system audio”. Only the sound is used, and it's transcribed on this device by an open-source speech model (a
              one-time download of about 80 MB). Keep this page open while you listen.
            </span>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-2 text-[13px] font-medium text-muted">Your notes</div>
        <Textarea
          value={meeting.myNotes}
          onChange={(e) => update(meeting.id, { myNotes: e.target.value })}
          placeholder={`Anything you want ${ai} to know — names, context, what matters to you…`}
          className="min-h-24 border-0 bg-transparent px-0 shadow-none focus:ring-0"
        />
      </Card>

      {/* The agent */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" className="h-11 px-5" onClick={run} disabled={busy || !hasKey || (!meeting.segments.length && !meeting.myNotes.trim())}>
          <Sparkles className={cn("size-4", busy && "animate-pulse")} />
          {busy ? `${ai} is reading the meeting…` : a ? "Regenerate notes & actions" : "Generate notes & actions"}
        </Button>
        {!hasKey && (
          <span className="text-[13px] text-muted">
            Needs an AI key —{" "}
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

/* ---------- Improving the transcript ---------- */

function ImproveRow({ meeting, hasKey }: { meeting: Meeting; hasKey: boolean }) {
  const ai = useAssistant();
  const job = useImprove();
  const running = job.meetingId === meeting.id && !!job.step;
  const otherRunning = !!job.step && job.meetingId !== meeting.id;
  const [clips, setClips] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // How many lines still have their audio, i.e. can be redone on this device.
  useEffect(() => {
    let live = true;
    countClips(meeting.id)
      .then((n) => live && setClips(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meeting.id, meeting.segments.length, running]);

  if (!clips && !hasKey) return null;

  const status =
    job.step === "download"
      ? `Downloading the more accurate model — ${Math.round(job.progress)}% (one time only, up to 600 MB)`
      : job.step === "transcribe"
        ? `Redoing the transcript on this device — ${job.done} of ${job.total}`
        : job.step === "correct"
          ? `${ai} is correcting what was misheard…`
          : null;

  const plan = clips
    ? `Redoes the transcript on this device with a more accurate model${hasKey ? `, then ${ai} fixes what was still misheard` : ""}. This takes a while — about as long as the speech itself, or longer on an older laptop.`
    : `${ai} reads the transcript and fixes what speech recognition misheard — names, numbers, words in other languages.`;

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
      <Button
        onClick={async () => {
          setError(null);
          try {
            await improveTranscript(meeting.id);
          } catch (e) {
            setError(explain(e));
          }
        }}
        disabled={running || otherRunning}
      >
        <Wand2 className={cn("size-4", running && "animate-pulse")} /> {running ? "Improving…" : "Improve transcript"}
      </Button>
      <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted">
        {running ? status : otherRunning ? "Another meeting's transcript is being improved." : (error ?? plan)}
      </span>
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
