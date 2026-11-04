import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, CalendarDays, Check, CircleSlash, ListTodo, Loader2, MessagesSquare, Mic, NotebookPen, RotateCcw, Square, Trash2, Undo2, Wallet, X } from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { useAiReady, useAssistant as useAssistantName } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { apply, describe, problemWith, type Description } from "./actions";
import { send } from "./ask";
import { useAssistant, type ChatMessage, type Proposal } from "./store";
import { VoiceNote, voiceSupported } from "./voice";

const ACCENT = "#8b5cf6";
const AREA_ICON: Record<Description["area"], typeof CalendarDays> = { calendar: CalendarDays, task: ListTodo, money: Wallet, note: NotebookPen };

const EXAMPLES = [
  "Add gym every Monday, Wednesday and Friday at 7am until December 20",
  "I spent 4500 on lunch today",
  "Plan 2 hours to finish the report before Friday",
  "How much have I spent on dining this month?",
  "Move tomorrow's team sync to 3pm",
  "Note: ideas for the holidays — visit Kribi, call grandma",
];

/** Undo for what was just applied, kept while Haven is open (it can't outlive the page). */
const undos = new Map<string, (() => void)[]>();

export function AssistantPage() {
  const messages = useAssistant((s) => s.messages);
  const clear = useAssistant((s) => s.clear);
  const ready = useAiReady();
  const ai = useAssistantName();
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await send(text.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col gap-6">
      <PageHeader
        eyebrow="Assistant"
        title="Assistant"
        actions={
          messages.length > 0 && (
            <Button
              variant="ghost"
              onClick={async () => {
                if (await ask({ title: "Start a new conversation?", body: "This conversation is cleared. Changes you applied stay where they are.", confirmLabel: "New conversation" })) clear();
              }}
            >
              <RotateCcw className="size-4" /> New conversation
            </Button>
          )
        }
      />

      {!ready ? (
        <Card>
          <EmptyState
            icon={<MessagesSquare className="size-5" />}
            title="Add an AI key to start"
            body="The assistant uses the AI service chosen in Settings — Anthropic, OpenAI or Groq — with your own key."
            action={
              <Link to="/settings" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-on-primary">
                Open Settings
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          {messages.length === 0 && (
            <Card className="p-6">
              <div className="mb-1 font-serif text-2xl">What can I do for you?</div>
              <p className="mb-5 text-[14px] text-muted">
                Ask about your days, money and notes, or tell me what to change. I'll propose the changes first — nothing happens until you approve.
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => void submit(e)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink">
                    {e}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}

          <AnimatePresence>
            {busy && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 px-1 text-[13px] text-muted">
                <Loader2 className="size-4 animate-spin" style={{ color: ACCENT }} /> {ai} is thinking…
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={bottom} />

          <div className="flex-1" />
          <Composer onSend={submit} busy={busy} />
        </div>
      )}
    </div>
  );
}

/* ---------- Messages ---------- */

function Message({ message: m }: { message: ChatMessage }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-on-primary">{m.text}</div>
      </div>
    );
  return (
    <div className="flex max-w-[92%] flex-col gap-2">
      <div className={cn("whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-2.5 text-[15px] leading-relaxed shadow-soft", m.error && "border-neg/30 text-neg")}>{m.text}</div>
      {m.proposals && <Proposals message={m} />}
    </div>
  );
}

function Proposals({ message }: { message: ChatMessage }) {
  const patchProposal = useAssistant((s) => s.patchProposal);
  const proposals = message.proposals!;
  const pending = proposals.filter((p) => p.status === "pending");
  const chosen = pending.filter((p) => p.include);
  const applied = proposals.filter((p) => p.status === "applied");
  const canUndo = applied.length > 0 && undos.has(message.id);

  const applyChosen = () => {
    const done: (() => void)[] = [];
    for (const p of pending) {
      if (!p.include) {
        patchProposal(message.id, p.id, { status: "skipped" });
        continue;
      }
      // Check again: your data may have changed since the proposal was made.
      const problem = problemWith(p.action);
      if (problem) {
        patchProposal(message.id, p.id, { status: "failed", problem });
        continue;
      }
      try {
        done.push(apply(p.action));
        patchProposal(message.id, p.id, { status: "applied" });
      } catch (e) {
        patchProposal(message.id, p.id, { status: "failed", problem: e instanceof Error ? e.message : String(e) });
      }
    }
    if (done.length) undos.set(message.id, done);
  };

  const undo = () => {
    // Newest first, so later changes are taken back before the ones they built on.
    for (const u of [...(undos.get(message.id) ?? [])].reverse()) u();
    undos.delete(message.id);
    for (const p of applied) patchProposal(message.id, p.id, { status: "undone" });
  };

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {proposals.map((p) => (
          <ProposalRow key={p.id} proposal={p} onToggle={() => patchProposal(message.id, p.id, { include: !p.include })} />
        ))}
      </ul>
      {(pending.length > 0 || canUndo) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/40 px-4 py-3">
          {pending.length > 0 ? (
            <>
              <span className="flex-1 text-[12px] text-muted">Nothing changes until you apply.</span>
              <Button variant="ghost" size="sm" onClick={() => pending.forEach((p) => patchProposal(message.id, p.id, { status: "skipped" }))}>
                <X className="size-3.5" /> Discard
              </Button>
              <Button variant="primary" size="sm" onClick={applyChosen} disabled={!chosen.length}>
                <Check className="size-3.5" /> Apply {chosen.length > 1 ? `all ${chosen.length}` : ""}
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[12px] text-muted">
                {applied.length} {applied.length === 1 ? "change" : "changes"} applied.
              </span>
              <Button size="sm" onClick={undo}>
                <Undo2 className="size-3.5" /> Undo
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

const STATUS: Partial<Record<Proposal["status"], { label: string; className: string }>> = {
  applied: { label: "Applied", className: "text-pos" },
  skipped: { label: "Not applied", className: "text-faint" },
  failed: { label: "Couldn't apply", className: "text-neg" },
  undone: { label: "Undone", className: "text-faint" },
};

function ProposalRow({ proposal: p, onToggle }: { proposal: Proposal; onToggle: () => void }) {
  const d = describe(p.action);
  const Icon = AREA_ICON[d.area];
  const pending = p.status === "pending";
  const status = STATUS[p.status];
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", !pending && p.status !== "applied" && "opacity-60")}>
      {pending ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={p.include}
          aria-label={p.include ? "Don't apply this" : "Apply this"}
          onClick={onToggle}
          className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors", p.include ? "border-transparent text-white" : "border-line-strong bg-surface")}
          style={p.include ? { background: ACCENT } : undefined}
        >
          {p.include && <Check className="size-3.5" strokeWidth={3} />}
        </button>
      ) : p.status === "applied" ? (
        <Check className="mt-0.5 size-5 shrink-0 text-pos" />
      ) : (
        <CircleSlash className="mt-0.5 size-5 shrink-0 text-faint" />
      )}
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-snug">
          <span className="text-muted">{d.verb} · </span>
          <span className="font-medium">{d.title}</span>
        </div>
        {d.details.map((line, i) => (
          <div key={i} className="break-words text-[12.5px] leading-relaxed text-muted">
            {line}
          </div>
        ))}
        {p.problem && <div className="mt-0.5 text-[12.5px] text-neg">{p.problem}</div>}
      </div>
      {status && <span className={cn("shrink-0 text-[12px] font-medium", status.className)}>{status.label}</span>}
    </li>
  );
}

/* ---------- Writing and speaking ---------- */

function Composer({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<{ rec: VoiceNote; since: number } | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [, tick] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a point.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (!voice) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [voice]);

  useEffect(() => () => voice?.rec.cancel(), [voice]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };

  const toggleVoice = async () => {
    if (voice) {
      setVoice(null);
      try {
        const said = await voice.rec.stop(setVoiceStatus);
        if (said) setText((t) => (t.trim() ? `${t.trim()} ${said}` : said));
        else setVoiceStatus("Didn't catch that — try again a little closer to the microphone.");
      } catch (e) {
        setVoiceStatus(e instanceof Error ? e.message : String(e));
        return;
      }
      setVoiceStatus(null);
      box.current?.focus();
      return;
    }
    setVoiceStatus(null);
    const rec = new VoiceNote();
    try {
      await rec.start();
      setVoice({ rec, since: Date.now() });
    } catch (e) {
      rec.cancel();
      setVoiceStatus((e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow it, then try again." : (e as Error).message);
    }
  };

  const seconds = voice ? Math.floor((Date.now() - voice.since) / 1000) : 0;

  return (
    <div className="sticky bottom-24 z-10 md:bottom-6">
      {voiceStatus && <div className="mb-2 px-2 text-[12.5px] text-muted">{voiceStatus}</div>}
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-raised p-2 shadow-float">
        {voiceSupported() && (
          <button
            type="button"
            onClick={() => void toggleVoice()}
            aria-label={voice ? "Stop and transcribe" : "Speak"}
            title={voice ? "Stop and transcribe" : "Speak"}
            className={cn("flex size-10 shrink-0 items-center justify-center rounded-full transition-colors", voice ? "bg-neg text-white" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {voice ? <Square className="size-4" fill="currentColor" /> : <Mic className="size-5" />}
          </button>
        )}
        {voice ? (
          <div className="flex h-10 flex-1 items-center gap-2 px-1 text-[14px] text-muted">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-neg opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-neg" />
            </span>
            Listening… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} — tap the square when you're done
            <button type="button" onClick={() => (voice.rec.cancel(), setVoice(null))} aria-label="Cancel recording" className="ml-auto rounded-lg p-1.5 text-faint hover:text-ink">
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : (
          <textarea
            ref={box}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask, or tell me what to change…"
            className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
          />
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy || !!voice}
          aria-label="Send"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-30"
          style={{ background: ACCENT }}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </div>
  );
}
