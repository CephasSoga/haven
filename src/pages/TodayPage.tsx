import { useMemo, useState } from "react";
import { Link } from "react-router";
import { addDays, format, isTomorrow } from "date-fns";
import { motion } from "motion/react";
import { ArrowRight, CalendarPlus, Plus, Sparkles } from "lucide-react";
import { Button, Card, CardHeader, Progress } from "@/components/ui";
import { dayKey, greeting, monthKey, parseDay, todayKey } from "@/lib/dates";
import { useMoney } from "@/lib/money";
import { sampleEvents, sampleFinances } from "@/lib/sample";
import { swatch } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { DayAgenda } from "@/modules/calendar/DayAgenda";
import { EventDialog } from "@/modules/calendar/EventDialog";
import { compareEvents, timeRange, useCalendar, type CalendarEvent, type EventDraft } from "@/modules/calendar/store";
import { TransactionDialog, type TxDraft } from "@/modules/finances/TransactionDialog";
import { TxRow } from "@/modules/finances/parts";
import { inMonth, sortTransactions, spendByCategory, totalBalance, totals, useFinance, type Transaction } from "@/modules/finances/store";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.05 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
});

export function TodayPage() {
  const { name, weekStartsOn } = useSettings();
  const events = useCalendar((s) => s.events);
  const replaceEvents = useCalendar((s) => s.replaceAll);
  const fin = useFinance();
  const money = useMoney();
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [txDraft, setTxDraft] = useState<TxDraft | null>(null);

  const now = new Date();
  const today = todayKey();
  const todays = useMemo(() => events.filter((e) => e.date === today).sort(compareEvents), [events, today]);
  const upcoming = useMemo(() => {
    const end = dayKey(addDays(parseDay(today), 14));
    return events
      .filter((e) => e.date > today && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b))
      .slice(0, 5);
  }, [events, today]);

  const monthTx = inMonth(fin.transactions, monthKey(now));
  const t = totals(monthTx);
  const spend = spendByCategory(monthTx);
  const budget = fin.categories.reduce((s, c) => s + (c.kind === "expense" ? c.budget ?? 0 : 0), 0);
  const budgetedSpend = fin.categories.reduce((s, c) => s + (c.budget ? spend.get(c.id) ?? 0 : 0), 0);
  const recent = sortTransactions(fin.transactions).slice(0, 3);
  const catById = new Map(fin.categories.map((c) => [c.id, c]));
  const accById = new Map(fin.accounts.map((a) => [a.id, a]));

  const isEmpty = events.length === 0 && fin.transactions.length === 0;
  const openEvent = (e: CalendarEvent) => setEventDraft({ ...e });
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
    replaceEvents(sampleEvents(new Date(), weekStartsOn));
  };

  const firstName = name.trim().split(/\s+/)[0];
  const remaining = todays.filter((e) => !e.end || e.end > format(now, "HH:mm")).length;

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
                <h2 className="font-serif text-3xl">A calm home for your days and your money.</h2>
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
              subtitle={todays.length ? `${todays.length} ${todays.length === 1 ? "event" : "events"}` : undefined}
              action={
                <Button size="sm" onClick={newEvent}>
                  <CalendarPlus className="size-3.5" /> Event
                </Button>
              }
            />
            <div className="p-3">
              <DayAgenda events={todays} onOpen={openEvent} onCreate={newEvent} compact />
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
                  <li key={e.id}>
                    <button onClick={() => openEvent(e)} className="flex w-full items-center gap-4 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sunken">
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
        </motion.div>
      </div>

      <EventDialog draft={eventDraft} onClose={() => setEventDraft(null)} />
      <TransactionDialog draft={txDraft} onClose={() => setTxDraft(null)} />
    </div>
  );
}
