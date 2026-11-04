import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { addDays, format, isTomorrow } from "date-fns";
import { motion } from "motion/react";
import { ArrowRight, CalendarPlus, Check, ListPlus, Newspaper, NotebookPen, Pin, Plus, ReceiptText, Sparkles } from "lucide-react";
import { Button, Card, CardHeader, Progress } from "@/components/ui";
import { greeting, monthKey, parseDay, todayKey } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { sampleEvents, sampleFinances, sampleNotes, sampleTasks } from "@/lib/sample";
import { swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { DayAgenda } from "@/modules/calendar/DayAgenda";
import { EventDialog } from "@/modules/calendar/EventDialog";
import { expandEvents, timeRange, toMinutes, useCalendar, type EventDraft, type TaskDraft } from "@/modules/calendar/store";
import { buildBlocks, slotsUntilNow, useNow, usePlan, type Block } from "@/modules/calendar/plan";
import { TaskDialog, newTaskDraft } from "@/modules/calendar/TaskDialog";
import { TransactionDialog, type TxDraft } from "@/modules/finances/TransactionDialog";
import { TxRow } from "@/modules/finances/parts";
import { inMonth, sortTransactions, spendByCategory, totalBalance, totals, useFinance, type Transaction } from "@/modules/finances/store";
import { compareNotes, preview, useNotes } from "@/modules/notes/store";
import { useLibrary } from "@/modules/library/store";
import { useFeed } from "@/modules/feed/store";
import { daysUntil, upcoming as upcomingRenewals, useSubscriptions, whenLabel } from "@/modules/subscriptions/store";
import { dueLabel } from "@/modules/finances/BillsTab";
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
  const notes = useNotes((s) => s.notes);
  const replaceNotes = useNotes((s) => s.replaceAll);
  const createNote = useNotes((s) => s.create);
  const navigate = useNavigate();
  const books = useLibrary((s) => s.books);
  const subs = useSubscriptions((s) => s.subs);
  const renewing = upcomingRenewals(subs, 7);
  const billsDue = [...fin.bills].filter((b) => daysUntil(b.due) <= 7).sort((a, b) => a.due.localeCompare(b.due));
  const edition = useFeed((s) => s.editions.find((e) => e.date === todayKey()));
  const headlines = edition ? [...edition.items].sort((a, b) => Number(!!b.lead) - Number(!!a.lead)).slice(0, 3) : [];
  const currentBook = books.filter((b) => b.status === "reading").sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  const money = useMoney();
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [txDraft, setTxDraft] = useState<TxDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);

  // Ticks every minute, so events leave the list once they're over.
  const now = useNow();
  const today = todayKey();
  const minute = now.getHours() * 60 + now.getMinutes();
  const todays = useMemo(
    () =>
      // Finished events drop off: past their end, or an hour after the start when there's no end. All-day events stay.
      (buildBlocks([parseDay(today)], events, tasks, plan).get(today) ?? []).filter(
        (b) => b.kind !== "event" || !b.start || (b.end ? toMinutes(b.end) : toMinutes(b.start) + 60) > minute,
      ),
    [events, tasks, plan, today, minute],
  );
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
  const pinnedNotes = [...notes].sort(compareNotes).filter((n) => n.pinned).slice(0, 3);
  const shownNotes = pinnedNotes.length ? pinnedNotes : [...notes].sort(compareNotes).slice(0, 3);
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
    replaceNotes(sampleNotes());
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

      {headlines.length > 0 && (
        <motion.div {...rise(1)}>
          <Link to="/morning" className="group block">
            <Card className="relative overflow-hidden p-6 transition-transform group-hover:-translate-y-0.5">
              <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-70 blur-3xl" style={{ background: "radial-gradient(circle, rgb(192 88 63 / 0.16), transparent 70%)" }} />
              <div className="relative grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#c0583f]">
                    <Newspaper className="size-3.5" /> This morning
                  </div>
                  <div className="font-serif text-[28px] leading-tight">{headlines[0].title}</div>
                  <p className="mt-2 line-clamp-2 text-[14px] text-muted">{headlines[0].summary}</p>
                </div>
                <ul className="flex flex-col justify-center gap-3 border-line md:border-l md:pl-6">
                  {headlines.slice(1).map((h) => (
                    <li key={h.id}>
                      <div className="text-[12px] text-faint">{h.source}</div>
                      <div className="line-clamp-2 text-[15px] font-medium leading-snug">{h.title}</div>
                    </li>
                  ))}
                  <li className="flex items-center gap-1 text-[13px] font-medium text-[#c0583f]">
                    {edition!.items.length} stories in today's edition <ArrowRight className="size-3.5" />
                  </li>
                </ul>
              </div>
            </Card>
          </Link>
        </motion.div>
      )}

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

          {(renewing.length > 0 || billsDue.length > 0) && (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#d6589f]" /> {billsDue.length ? "Due this week" : "Renewing soon"}</span>}
                action={
                  <Link to={billsDue.length ? "/finances" : "/subscriptions"} className="flex items-center gap-1 text-[13px] font-medium text-[#d6589f] hover:underline">
                    {billsDue.length ? "Finances" : "Subscriptions"} <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
              <ul className="p-3">
                {billsDue.slice(0, 4).map((b) => {
                  const late = daysUntil(b.due) < 0;
                  return (
                    <li key={b.id} className="flex items-center gap-3 rounded-2xl px-3 py-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: swatch(b.color).soft, color: swatch(b.color).fg }}>
                        <ReceiptText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{b.name}</span>
                        <span className={`block text-[12px] ${late ? "font-medium text-neg" : "text-muted"}`}>{dueLabel(b.due)}</span>
                      </span>
                      <span className="font-medium tabular">{money(b.amount)}</span>
                      <button
                        onClick={() => fin.payBill(b.id)}
                        aria-label={`Mark ${b.name} paid`}
                        title="Mark paid"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-pos hover:bg-pos/10 hover:text-pos"
                      >
                        <Check className="size-4" />
                      </button>
                    </li>
                  );
                })}
                {renewing.slice(0, 4).map(({ sub, date, kind }) => (
                  <li key={sub.id} className="flex items-center gap-3 rounded-2xl px-3 py-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[16px]" style={{ background: swatch(sub.color).soft, color: swatch(sub.color).fg }}>
                      {sub.emoji || sub.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{sub.name}</span>
                      <span className={`block text-[12px] ${kind === "trial" ? "font-medium text-[#b7791f]" : "text-muted"}`}>
                        {kind === "trial" ? "Free trial ends" : "Renews"} {whenLabel(date)}
                      </span>
                    </span>
                    <span className="font-medium tabular">{money(sub.price)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
            <span className="size-2 rounded-full bg-note" /> {pinnedNotes.length ? "Pinned notes" : "Recent notes"}
          </h2>
          <Link to="/notes" className="flex items-center gap-1 text-[13px] font-medium text-note hover:underline">
            Notes <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shownNotes.map((n) => {
            const s = swatch(n.color);
            return (
              <Link
                key={n.id}
                to={`/notes?id=${n.id}`}
                className="group relative flex min-h-40 flex-col overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card transition-transform hover:-translate-y-0.5"
              >
                <div
                  className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full blur-2xl"
                  style={{ background: `radial-gradient(circle, ${s.soft}, transparent 70%)` }}
                />
                <div className="relative flex items-start justify-between gap-2">
                  <h3 className="font-serif text-2xl leading-tight">{n.title || "Untitled"}</h3>
                  {n.pinned && <Pin className="mt-1.5 size-3.5 shrink-0 text-faint" />}
                </div>
                <p className="relative mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted">{preview(n)}</p>
              </Link>
            );
          })}
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
