import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { addDays, format, isTomorrow } from "date-fns";
import { motion } from "motion/react";
import { ArrowRight, CalendarPlus, ListPlus, NotebookPen, Plus, Sparkles, Star } from "lucide-react";
import { Button, Card, CardHeader, Progress } from "@/components/ui";
import { greeting, monthKey, parseDay, todayKey } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { sampleEvents, sampleFinances, samplePages, sampleTasks } from "@/lib/sample";
import { swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { DayAgenda } from "@/modules/calendar/DayAgenda";
import { EventDialog } from "@/modules/calendar/EventDialog";
import { expandEvents, timeRange, useCalendar, type EventDraft, type TaskDraft } from "@/modules/calendar/store";
import { buildBlocks, slotsUntilNow, usePlan, type Block } from "@/modules/calendar/plan";
import { TaskDialog, newTaskDraft } from "@/modules/calendar/TaskDialog";
import { TransactionDialog, type TxDraft } from "@/modules/finances/TransactionDialog";
import { TxRow } from "@/modules/finances/parts";
import { inMonth, sortTransactions, spendByCategory, totalBalance, totals, useFinance, type Transaction } from "@/modules/finances/store";
import { COVERS, pageText, useNotes } from "@/modules/notes/store";
import { useLibrary } from "@/modules/library/store";
import { Cover } from "@/modules/library/Cover";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.05 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
});

export function TodayPage() {
  const { name, weekStartsOn } = useSettings();
  const { events, tasks, completeTask, reopenTask } = useCalendar();
  const replaceCalendar = useCalendar((s) => s.replaceAll);
  const plan = usePlan();
  const fin = useFinance();
  const allPages = useNotes((s) => s.pages);
  const notes = useMemo(() => allPages.filter((p) => !p.trashedAt), [allPages]);
  const replaceNotes = useNotes((s) => s.replaceAll);
  const createNote = useNotes((s) => s.create);
  const navigate = useNavigate();
  const books = useLibrary((s) => s.books);
  const currentBook = books.filter((b) => b.status === "reading").sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  const money = useMoney();
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [txDraft, setTxDraft] = useState<TxDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);

  const now = new Date();
  const today = todayKey();
  const todays = useMemo(() => buildBlocks([parseDay(today)], events, tasks, plan).get(today) ?? [], [events, tasks, plan, today]);
  const upcoming = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(parseDay(today), i + 1));
    return [...expandEvents(events, days).values()].flat().filter((e) => e.start).slice(0, 5);
  }, [events, today]);

  const monthTx = inMonth(fin.transactions, monthKey(now));
  const t = totals(monthTx);
  const spend = spendByCategory(monthTx);
  const budget = fin.categories.reduce((s, c) => s + (c.kind === "expense" ? c.budget ?? 0 : 0), 0);
  const budgetedSpend = fin.categories.reduce((s, c) => s + (c.budget ? spend.get(c.id) ?? 0 : 0), 0);
  const recent = sortTransactions(fin.transactions).slice(0, 3);
  const catById = new Map(fin.categories.map((c) => [c.id, c]));
  const accById = new Map(fin.accounts.map((a) => [a.id, a]));

  const isEmpty = events.length === 0 && tasks.length === 0 && fin.transactions.length === 0 && notes.length === 0;
  const recentFirst = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinnedNotes = recentFirst.filter((n) => n.favorite).slice(0, 3);
  const shownNotes = pinnedNotes.length ? pinnedNotes : recentFirst.slice(0, 3);
  const openEvent = (id: string) => {
    const e = events.find((x) => x.id === id);
    if (e) setEventDraft({ ...e });
  };
  const openBlock = (b: Block) => {
    if (b.kind === "event") return openEvent(b.id);
    const t = tasks.find((x) => x.id === b.id);
    if (t) setTaskDraft({ ...t });
  };
  const toggleBlock = (b: Block) => {
    const t = tasks.find((x) => x.id === b.id);
    if (!t) return;
    if (t.done) reopenTask(t.id);
    else completeTask(t.id, slotsUntilNow(plan.byTask.get(t.id)?.slots ?? []));
  };
  const newEvent = () => setEventDraft({ title: "", date: today, start: "09:00", end: "10:00", color: "violet" });
  const newTx = () =>
    setTxDraft({
      kind: "expense",
      date: today,
      categoryId: fin.categories.find((c) => c.kind === "expense")?.id ?? "",
      accountId: fin.accounts[0]?.id ?? "",
    });
  const openTx = (tx: Transaction) => setTxDraft({ ...tx });

  const loadSample = () => {
    fin.replaceAll(sampleFinances());
    replaceCalendar({ events: sampleEvents(new Date(), weekStartsOn), tasks: sampleTasks() });
    replaceNotes(samplePages());
  };

  const firstName = name.trim().split(/\s+/)[0];
  const remaining = todays.filter((b) => !b.done && b.start && (!b.end || b.end > format(now, "HH:mm"))).length;
  const taskCount = todays.filter((b) => b.kind === "task" && !b.done).length;

  return (
    <div className="flex flex-col gap-8">
      <motion.header {...rise(0)}>
        <div className="mb-2 text-[13px] font-medium text-muted">{format(now, "EEEE, MMMM d")}</div>
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          {greeting(now)}
          {firstName && <>, <em className="text-cal">{firstName}</em></>}.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-muted">
          {todays.length === 0
            ? "Your day is wide open."
            : remaining === 0
              ? "That's everything on today's calendar. Nicely done."
              : `${remaining} ${remaining === 1 ? "thing" : "things"} left on your calendar today.`}{" "}
          {t.expense > 0 && <>You've spent {money(t.expense)} so far in {format(now, "MMMM")}.</>}
        </p>
      </motion.header>

      {isEmpty && (
        <motion.div {...rise(1)}>
          <Card className="relative overflow-hidden p-8">
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{ background: "radial-gradient(60% 120% at 100% 0%, var(--cal-soft), transparent), radial-gradient(50% 100% at 0% 100%, var(--fin-soft), transparent)" }}
            />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-cal">
                  <Sparkles className="size-4" /> Welcome to Haven
                </div>
                <h2 className="font-serif text-3xl">A calm home for your days, your money and your thoughts.</h2>
                <p className="mt-2 max-w-lg text-sm text-muted">
                  Everything stays on this device. Start with a blank slate, or explore with some sample data first — you can
                  clear it any time from Settings.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button onClick={loadSample}>Explore with sample data</Button>
                <Button variant="primary" onClick={newEvent}>
                  Start fresh
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <motion.div {...rise(2)} className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-cal" /> Today</span>}
              subtitle={
                todays.length
                  ? `${todays.length - taskCount - todays.filter((b) => b.kind === "task" && b.done).length} events · ${taskCount} ${taskCount === 1 ? "task" : "tasks"} planned`
                  : undefined
              }
              action={
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={newEvent}>
                    <CalendarPlus className="size-3.5" /> Event
                  </Button>
                  <Button size="sm" onClick={() => setTaskDraft(newTaskDraft())}>
                    <ListPlus className="size-3.5" /> Task
                  </Button>
                </div>
              }
            />
            <div className="p-3">
              <DayAgenda blocks={todays} onOpen={openBlock} onToggle={toggleBlock} onCreate={newEvent} compact />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Coming up"
              subtitle="Next two weeks"
              action={
                <Link to="/calendar" className="flex items-center gap-1 text-[13px] font-medium text-cal hover:underline">
                  Calendar <ArrowRight className="size-3.5" />
                </Link>
              }
            />
            <ul className="p-3">
              {upcoming.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing on the horizon.</li>}
              {upcoming.map((e) => {
                const d = parseDay(e.date);
                return (
                  <li key={e.id + e.date}>
                    <button onClick={() => openEvent(e.id)} className="flex w-full items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sunken">
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-xl border border-line py-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: swatch(e.color).fg }}>
                          {format(d, "EEE")}
                        </span>
                        <span className="font-serif text-xl leading-none">{format(d, "d")}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{e.title}</div>
                        <div className="text-[13px] text-muted tabular">
                          {isTomorrow(d) ? "Tomorrow · " : ""}
                          {timeRange(e)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </motion.div>

        <motion.div {...rise(3)} className="flex flex-col gap-6">
          <Card className="relative overflow-hidden">
            <div
              className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full opacity-70 blur-3xl"
              style={{ background: "radial-gradient(circle, var(--fin-soft), transparent 70%)" }}
            />
            <CardHeader
              className="relative"
              title={<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-fin" /> Money</span>}
              subtitle={format(now, "MMMM")}
              action={
                <Button size="sm" onClick={newTx}>
                  <Plus className="size-3.5" /> Expense
                </Button>
              }
            />
            <div className="relative px-6 pb-6 pt-4">
              <div className="text-[13px] text-muted">Total balance</div>
              <div className="font-serif text-5xl leading-none tabular">{money(totalBalance(fin.accounts, fin.transactions))}</div>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[12px] text-muted">In</div>
                  <div className="text-lg font-semibold text-pos tabular">{money(t.income)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">Out</div>
                  <div className="text-lg font-semibold tabular">{money(t.expense)}</div>
                </div>
              </div>
              {budget > 0 && (
                <div className="mt-6">
                  <div className="mb-2 flex justify-between text-[13px]">
                    <span className="text-muted">Budgets</span>
                    <span className="tabular">
                      {money(Math.max(budget - budgetedSpend, 0))} <span className="text-muted">left</span>
                    </span>
                  </div>
                  <Progress value={budgetedSpend / budget} color={budgetedSpend > budget ? "var(--neg)" : "var(--fin)"} />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Latest transactions"
              action={
                <Link to="/finances" className="flex items-center gap-1 text-[13px] font-medium text-fin hover:underline">
                  Finances <ArrowRight className="size-3.5" />
                </Link>
              }
            />
            <div className="p-3">
              {recent.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">No transactions yet.</div>}
              {recent.map((tx) => (
                <TxRow key={tx.id} tx={tx} category={catById.get(tx.categoryId)} account={accById.get(tx.accountId)} onClick={() => openTx(tx)} />
              ))}
            </div>
          </Card>

          {currentBook && (
            <Link to={`/library?read=${currentBook.id}`} className="group">
              <Card className="flex items-center gap-4 p-4 transition-transform group-hover:-translate-y-0.5">
                <div className="w-14 shrink-0">
                  <Cover book={currentBook} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">Reading</div>
                  <div className="truncate font-serif text-xl leading-tight">{currentBook.title}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-cal" style={{ width: `${currentBook.progress * 100}%` }} />
                    </div>
                    <span className="text-[12px] text-muted tabular">{Math.round(currentBook.progress * 100)}%</span>
                  </div>
                </div>
              </Card>
            </Link>
          )}
        </motion.div>
      </div>

      <motion.section {...rise(4)} className="flex flex-col gap-3">
        <div className="flex items-end justify-between px-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="size-2 rounded-full bg-note" /> {pinnedNotes.length ? "Favorite pages" : "Recent pages"}
          </h2>
          <Link to="/notes" className="flex items-center gap-1 text-[13px] font-medium text-note hover:underline">
            Notes <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shownNotes.map((n) => (
            <Link
              key={n.id}
              to={`/notes?id=${n.id}`}
              className="group relative flex min-h-40 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card transition-transform hover:-translate-y-0.5"
            >
              <div className="h-12 shrink-0" style={{ background: (n.cover && COVERS[n.cover]) || "var(--sunken)" }} />
              <div className="relative flex flex-1 flex-col px-5 pb-5">
                <span className="-mt-5 mb-1 text-[32px] leading-none">{n.icon ?? "📄"}</span>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-serif text-2xl leading-tight">{n.title || "Untitled"}</h3>
                  {n.favorite && <Star className="mt-1.5 size-3.5 shrink-0 fill-current text-note" />}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{pageText(n.content)}</p>
              </div>
            </Link>
          ))}
          <button
            onClick={() => navigate(`/notes?id=${createNote()}`)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line text-muted transition-colors hover:border-line-strong hover:bg-surface hover:text-ink"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-sunken">
              <NotebookPen className="size-[18px]" />
            </span>
            <span className="text-sm font-medium">Jot something down</span>
          </button>
        </div>
      </motion.section>

      <EventDialog draft={eventDraft} onClose={() => setEventDraft(null)} />
      <TransactionDialog draft={txDraft} onClose={() => setTxDraft(null)} />
      <TaskDialog draft={taskDraft} onClose={() => setTaskDraft(null)} />
    </div>
  );
}
