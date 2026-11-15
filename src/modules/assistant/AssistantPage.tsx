import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleSlash,
  ListTodo,
  Loader2,
  MessagesSquare,
  Mic,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Square,
  Trash2,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { ask } from "@/components/confirm";
import { Button, Card, EmptyState, IconButton, PageHeader } from "@/components/ui";
import { useAiReady, useAssistant as useAssistantName } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { apply, describe, problemWith, type Description } from "./actions";
import { send, stop } from "./ask";
import { sortChats, useAssistant, type Chat, type ChatMessage, type Proposal } from "./store";
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
  const chats = useAssistant((s) => s.chats);
  const ready = useAiReady();
  const [params, setParams] = useSearchParams();
  const current = chats.find((c) => c.id === params.get("c")) ?? null;
  const open = (id: string | null) => setParams(id ? { c: id } : {}, { replace: true });

  /** A first message without a chat open starts a new one. */
  const startWith = (text: string) => {
    const id = useAssistant.getState().create();
    open(id);
    void send(id, text);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Assistant"
        title="Assistant"
        actions={
          ready && (
            <Button variant="primary" onClick={() => open(useAssistant.getState().create())}>
              <Plus className="size-4" /> New chat
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
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className={cn("lg:block", current ? "hidden" : "block")}>
            <ChatList chats={chats} currentId={current?.id ?? null} onOpen={open} />
          </div>
          <div className={cn("min-w-0 lg:block", current ? "block" : "hidden")}>
            {current ? <ChatView key={current.id} chat={current} onBack={() => open(null)} onDeleted={() => open(null)} /> : <Welcome onSend={startWith} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- The list of chats ---------- */

function ChatList({ chats, currentId, onOpen }: { chats: Chat[]; currentId: string | null; onOpen: (id: string) => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const active = sortChats(chats.filter((c) => !c.archived));
  const archived = sortChats(chats.filter((c) => c.archived));
  if (!chats.length)
    return (
      <Card className="px-5 py-8 text-center text-[13px] text-muted">
        Your chats will be listed here. Start one with a question or something to change.
      </Card>
    );
  return (
    <Card className="overflow-hidden lg:sticky lg:top-8 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
      <ul className="p-2">
        {active.map((c) => (
          <ChatRow key={c.id} chat={c} active={c.id === currentId} onOpen={() => onOpen(c.id)} />
        ))}
      </ul>
      {archived.length > 0 && (
        <div className="border-t border-line p-2">
          <button onClick={() => setShowArchived(!showArchived)} className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink">
            <ChevronDown className={cn("size-3.5 transition-transform", !showArchived && "-rotate-90")} /> Archived · {archived.length}
          </button>
          {showArchived && (
            <ul>
              {archived.map((c) => (
                <ChatRow key={c.id} chat={c} active={c.id === currentId} onOpen={() => onOpen(c.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function ChatRow({ chat, active, onOpen }: { chat: Chat; active: boolean; onOpen: () => void }) {
  const update = useAssistant((s) => s.update);
  const waiting = useAssistant((s) => !!s.pending[chat.id]);
  return (
    <li className="group relative">
      <button onClick={onOpen} className={cn("w-full rounded-2xl px-3.5 py-2.5 pr-16 text-left transition-colors", active ? "bg-sunken" : "hover:bg-sunken/60")}>
        <div className="flex items-center gap-1.5">
          {chat.pinned && <Pin className="size-3 shrink-0 text-faint" />}
          <span className="truncate text-[14px] font-medium">{chat.title || "New chat"}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
          {waiting && <Loader2 className="size-3 animate-spin" style={{ color: ACCENT }} />}
          {waiting ? "Thinking…" : `${chat.messages.length} ${chat.messages.length === 1 ? "message" : "messages"} · ${formatDistanceToNowStrict(chat.updatedAt, { addSuffix: true })}`}
        </div>
      </button>
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-lg:opacity-100">
        <IconButton label={chat.pinned ? "Unpin" : "Pin"} onClick={() => update(chat.id, { pinned: !chat.pinned })} className="size-7">
          {chat.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </IconButton>
        <IconButton label={chat.archived ? "Unarchive" : "Archive"} onClick={() => update(chat.id, { archived: !chat.archived, pinned: chat.archived ? chat.pinned : false })} className="size-7">
          {chat.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
        </IconButton>
      </div>
    </li>
  );
}

/* ---------- One chat ---------- */

function Welcome({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6">
        <div className="mb-1 font-serif text-2xl">What can I do for you?</div>
        <p className="mb-5 text-[14px] text-muted">
          Ask about your days, money and notes, or tell me what to change. I'll propose the changes first — nothing happens until you approve.
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => onSend(e)} className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink">
              {e}
            </button>
          ))}
        </div>
      </Card>
      <Composer onSend={onSend} busy={false} />
    </div>
  );
}

function ChatView({ chat, onBack, onDeleted }: { chat: Chat; onBack: () => void; onDeleted: () => void }) {
  const { update, remove } = useAssistant();
  const startedAt = useAssistant((s) => s.pending[chat.id]);
  const ai = useAssistantName();
  const bottom = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages.length, !!startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // While waiting, count the seconds, so a slow answer never looks like a frozen screen.
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  const seconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4">
      <div className="flex items-center gap-1">
        <IconButton label="All chats" onClick={onBack} className="-ml-2 lg:hidden">
          <ChevronLeft className="size-5" />
        </IconButton>
        <input
          value={chat.title}
          onChange={(e) => update(chat.id, { title: e.target.value })}
          placeholder="New chat"
          aria-label="Chat title"
          className="min-w-0 flex-1 bg-transparent font-serif text-[26px] leading-tight tracking-tight placeholder:text-faint focus:outline-none"
        />
        <IconButton label={chat.pinned ? "Unpin" : "Pin"} onClick={() => update(chat.id, { pinned: !chat.pinned })}>
          {chat.pinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}
        </IconButton>
        <IconButton label={chat.archived ? "Unarchive" : "Archive"} onClick={() => update(chat.id, { archived: !chat.archived, pinned: chat.archived ? chat.pinned : false })}>
          {chat.archived ? <ArchiveRestore className="size-[18px]" /> : <Archive className="size-[18px]" />}
        </IconButton>
        <IconButton
          label="Delete chat"
          className="hover:text-neg"
          onClick={async () => {
            if (!(await ask({ title: "Delete this chat?", body: "The conversation is deleted. Changes you applied from it stay where they are.", confirmLabel: "Delete", danger: true }))) return;
            stop(chat.id);
            remove(chat.id);
            onDeleted();
          }}
        >
          <Trash2 className="size-[18px]" />
        </IconButton>
      </div>

      {chat.messages.length === 0 && !startedAt && (
        <Card className="p-5 text-[14px] text-muted">Ask a question, or tell me what to change — I'll propose it first.</Card>
      )}
      {chat.messages.map((m) => (
        <Message key={m.id} chatId={chat.id} message={m} />
      ))}

      <AnimatePresence>
        {startedAt && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-2 px-1 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" style={{ color: ACCENT }} />
            {ai} is thinking… {seconds}s
            {seconds >= 20 && <span className="text-faint">· this one is taking a while</span>}
            <Button size="sm" variant="ghost" onClick={() => stop(chat.id)}>
              <Square className="size-3" fill="currentColor" /> Stop
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={bottom} />

      <div className="flex-1" />
      <Composer onSend={(text) => void send(chat.id, text)} busy={!!startedAt} />
    </div>
  );
}

/* ---------- Messages ---------- */

function Message({ chatId, message: m }: { chatId: string; message: ChatMessage }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-on-primary">{m.text}</div>
      </div>
    );
  return (
    <div className="flex max-w-[92%] flex-col gap-2">
      <div className={cn("whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-2.5 text-[15px] leading-relaxed shadow-soft", m.error && "border-neg/30 text-neg")}>{m.text}</div>
      {m.proposals && <Proposals chatId={chatId} message={m} />}
    </div>
  );
}

function Proposals({ chatId, message }: { chatId: string; message: ChatMessage }) {
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
        patchProposal(chatId, message.id, p.id, { status: "skipped" });
        continue;
      }
      // Check again: your data may have changed since the proposal was made.
      const problem = problemWith(p.action);
      if (problem) {
        patchProposal(chatId, message.id, p.id, { status: "failed", problem });
        continue;
      }
      try {
        done.push(apply(p.action));
        patchProposal(chatId, message.id, p.id, { status: "applied" });
      } catch (e) {
        patchProposal(chatId, message.id, p.id, { status: "failed", problem: e instanceof Error ? e.message : String(e) });
      }
    }
    if (done.length) undos.set(message.id, done);
  };

  const undo = () => {
    // Newest first, so later changes are taken back before the ones they built on.
    for (const u of [...(undos.get(message.id) ?? [])].reverse()) u();
    undos.delete(message.id);
    for (const p of applied) patchProposal(chatId, message.id, p.id, { status: "undone" });
  };

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {proposals.map((p) => (
          <ProposalRow key={p.id} proposal={p} onToggle={() => patchProposal(chatId, message.id, p.id, { include: !p.include })} />
        ))}
      </ul>
      {(pending.length > 0 || canUndo) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/40 px-4 py-3">
          {pending.length > 0 ? (
            <>
              <span className="flex-1 text-[12px] text-muted">Nothing changes until you apply.</span>
              <Button variant="ghost" size="sm" onClick={() => pending.forEach((p) => patchProposal(chatId, message.id, p.id, { status: "skipped" }))}>
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
