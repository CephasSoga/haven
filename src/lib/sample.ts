import { addDays, eachDayOfInterval, getDay, getDate, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { dayKey } from "./dates";
import { uid } from "./utils";
import type { CalendarEvent, Task } from "@/modules/calendar/store";
import { DEFAULT_CATEGORIES, type FinanceData, type Transaction } from "@/modules/finances/store";
import type { Page } from "@/modules/notes/store";

/** Small deterministic PRNG so sample data looks the same every time. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleFinances(today = new Date()): FinanceData {
  const r = rng(42);
  const between = (min: number, max: number) => Math.round((min + r() * (max - min)) * 100);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const txs: Transaction[] = [];
  const add = (date: Date, kind: Transaction["kind"], categoryId: string, amount: number, note?: string, accountId = "main") =>
    txs.push({ id: uid(), kind, categoryId, amount, date: dayKey(date), note, accountId });

  for (const d of eachDayOfInterval({ start: startOfMonth(subMonths(today, 5)), end: today })) {
    const dom = getDate(d);
    const dow = getDay(d);
    if (dom === 1) add(d, "income", "salary", 320000, "Monthly salary");
    if (dom === 2) add(d, "income", "other-income", between(4, 9), "Interest", "savings");
    if (dom === 3) add(d, "expense", "housing", 115000, "Rent");
    if (dom === 5) add(d, "expense", "utilities", between(85, 140), "Electricity & water");
    if (dom === 6) add(d, "expense", "utilities", 3999, "Internet");
    if (dom === 8) add(d, "expense", "subscriptions", 1099, "Music streaming");
    if (dom === 12) add(d, "expense", "subscriptions", 1399, "Video streaming");
    if (dom === 15 && d.getMonth() % 2 === 0) add(d, "income", "freelance", between(450, 900), "Logo project");
    if (dow === 6) add(d, "expense", "groceries", between(55, 120), pick(["Weekly groceries", "Market run", "Supermarket"]));
    if (dow === 3 && r() < 0.6) add(d, "expense", "groceries", between(12, 35), "Bakery & fruit", "cash");
    if (r() < 0.28) add(d, "expense", "dining", between(9, 58), pick(["Lunch out", "Coffee & pastry", "Dinner with friends", "Takeaway"]));
    if (r() < 0.18) add(d, "expense", "transport", between(2, 45), pick(["Metro pass top-up", "Fuel", "Train ticket", "Ride"]));
    if (r() < 0.06) add(d, "expense", "shopping", between(25, 140), pick(["New shoes", "Home goods", "Books", "Kitchenware"]));
    if (r() < 0.06) add(d, "expense", "leisure", between(10, 60), pick(["Cinema", "Concert tickets", "Museum", "Bowling"]));
    if (r() < 0.035) add(d, "expense", "health", between(8, 45), pick(["Pharmacy", "Doctor visit"]));
  }

  return {
    accounts: [
      { id: "main", name: "Everyday", kind: "checking", opening: 185000, color: "violet" },
      { id: "savings", name: "Savings", kind: "savings", opening: 640000, color: "teal" },
      { id: "cash", name: "Cash", kind: "cash", opening: 48000, color: "amber" },
    ],
    categories: DEFAULT_CATEGORIES,
    transactions: txs,
  };
}

export function samplePages(now = Date.now()): Page[] {
  const h = 3_600_000;
  const text = (t: string, styles?: Record<string, boolean>) => ({ type: "text", text: t, styles: styles ?? {} });
  const p = (content: string | object[]) => ({ type: "paragraph", content });
  const h2 = (content: string) => ({ type: "heading", props: { level: 2 }, content });
  const h3 = (content: string) => ({ type: "heading", props: { level: 3 }, content });
  const li = (content: string) => ({ type: "bulletListItem", content });
  const ol = (content: string) => ({ type: "numberedListItem", content });
  const todo = (content: string, checked = false) => ({ type: "checkListItem", props: { checked }, content });
  const quote = (content: string) => ({ type: "quote", content });
  const toggle = (content: string, children: object[]) => ({ type: "toggleListItem", content, children });
  const page = (id: string, title: string, icon: string, content: object[], o: Partial<Page> & { age: number }): Page => ({
    id,
    parentId: null,
    title,
    icon,
    content: content as Page["content"],
    favorite: false,
    createdAt: now - o.age * h - 96 * h,
    updatedAt: now - o.age * h,
    ...o,
  });
  const ids = { trip: uid(), haven: uid(), reading: uid(), weeks: uid(), pasta: uid(), journal: uid(), today: uid(), work: uid(), review: uid() };

  return [
    page(ids.trip, "Weekend in the mountains", "🏔️", [
      p([text("Train leaves "), text("Friday at 18:12", { bold: true }), text(" — book seats by Wednesday.")]),
      h2("Packing"),
      todo("Hiking boots & rain jacket", true),
      todo("Thermos and trail snacks", true),
      todo("Camera + spare battery"),
      todo("Paper map, just in case"),
      h2("Plan"),
      ol("Saturday: the ridge loop, lunch at the hut"),
      ol("Sunday: lake swim if it's warm, slow breakfast if not"),
      quote("Leave the laptop at home. Really."),
    ], { cover: "sea", favorite: true, age: 2 }),

    page(ids.haven, "Ideas for Haven", "💡", [
      p("Things I'd love the app to do next:"),
      li("Turn a to-do in a note into a scheduled task"),
      li("Recurring bills that show up on the calendar"),
      li("Install it on my phone"),
      toggle("Someday, maybe", [li("Sync between devices"), li("A yearly review page that writes itself")]),
    ], { cover: "dawn", favorite: true, age: 20 }),

    page(ids.reading, "Reading", "📚", [
      p("What I'm reading, and what's next."),
      h3("Now"),
      li("Piranesi — Susanna Clarke"),
      h3("Next"),
      li("The Overstory"),
      li("A Psalm for the Wild-Built"),
    ], { age: 50 }),
    page(ids.weeks, "Four Thousand Weeks — notes", "🕰️", [
      quote("The average human lifespan is absurdly, terrifyingly, insultingly short."),
      p("The book's real point: you will never get everything done, so choose deliberately what to neglect."),
      h3("Ideas to try"),
      todo("Fixed volume: no more than three big things in progress", true),
      todo("Decide in advance what to fail at this week"),
    ], { parentId: ids.reading, age: 60 }),

    page(ids.pasta, "Lemon pasta", "🍋", [
      h3("Ingredients"),
      li("Spaghetti, 400 g"),
      li("2 lemons — zest and juice"),
      li("Butter, parmesan, black pepper"),
      h3("Method"),
      ol("Cook the pasta; keep a ladle of the water."),
      ol("Melt butter with the zest, add the juice."),
      ol("Toss off the heat with parmesan and pasta water until glossy."),
      p([text("Basil on top. ", { italic: true }), text("Serves 3.")]),
    ], { cover: "citrus", age: 96 }),

    page(ids.journal, "Journal", "📓", [p("A line or two a day.")], { age: 30 }),
    page(ids.today, "A slow Sunday", "☕", [
      p("Long walk by the river this morning. Lunch with Amara — she's moving to Lisbon in spring."),
      p("Note to self: plan the mountain weekend properly this week."),
    ], { parentId: ids.journal, age: 1 }),

    page(ids.work, "Work", "💼", [p("Meeting notes and working documents.")], { cover: "ink", age: 120 }),
    page(ids.review, "Design review — notes", "🎨", [
      p("Went well overall. Typography felt calmer after the spacing pass."),
      h3("Follow-ups"),
      todo("Send revised mockups by Thursday"),
      todo("Ask about the empty states on mobile"),
      todo("Book a follow-up with Sam", true),
    ], { parentId: ids.work, age: 5 }),
  ];
}

export function sampleEvents(today = new Date(), weekStartsOn: 0 | 1 = 1): CalendarEvent[] {
  const ev = (date: Date, title: string, color: string, start?: string, end?: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: uid(),
    title,
    date: dayKey(date),
    start,
    end,
    color,
    ...extra,
  });
  // Recurring rhythms, anchored in last week so they show up in the past too.
  const base = addDays(startOfWeek(today, { weekStartsOn }), -7);
  const at = (dayOfWeek: number) => addDays(base, (dayOfWeek - weekStartsOn + 7) % 7);
  const out: CalendarEvent[] = [
    ev(at(1), "Team sync", "violet", "09:30", "10:00", { location: "Studio", repeat: "weekly" }),
    ev(at(2), "Yoga", "green", "18:30", "19:30", { location: "Riverside studio", repeat: "weekly" }),
    ev(at(4), "Yoga", "green", "18:30", "19:30", { location: "Riverside studio", repeat: "weekly" }),
    ev(at(3), "1:1 with Sam", "blue", "15:00", "15:30", { repeat: "weekly" }),
    ev(at(6), "Farmers market", "amber", "10:00", "11:30", { repeat: "weekly" }),
    ev(at(1), "Standup", "slate", "09:00", "09:15", { repeat: "weekdays" }),
  ];

  out.push(
    ev(today, "Morning run", "teal", "07:00", "07:45"),
    ev(today, "Design review", "violet", "11:00", "12:00", { location: "Room 3" }),
    ev(today, "Lunch with Amara", "orange", "12:30", "13:30", { location: "Le Petit Jardin" }),
    ev(today, "Call with the bank", "slate", "16:00", "16:30"),
    ev(addDays(today, 1), "Dentist", "rose", "09:00", "09:45", { notes: "Bring insurance card" }),
    ev(addDays(today, 2), "Movie night", "pink", "20:00", "22:30"),
    ev(addDays(today, 4), "Mum's birthday", "pink"),
    ev(addDays(today, 9), "Weekend in the mountains", "teal"),
    ev(addDays(today, 10), "Weekend in the mountains", "teal"),
    ev(addDays(today, -3), "Haircut", "slate", "17:00", "17:45"),
    ev(addDays(today, 6), "Dinner with family", "orange", "19:00", "21:30"),
    ev(addDays(today, 13), "Quarterly review", "violet", "14:00", "15:30"),
  );
  return out;
}

export function sampleTasks(today = new Date()): Task[] {
  const d = (n: number) => dayKey(addDays(today, n));
  const t = (p: Omit<Task, "id" | "createdAt">, i: number): Task => ({ id: uid(), createdAt: today.getTime() - (20 - i) * 60_000, ...p });
  return [
    { title: "Reply to the landlord about the lease", duration: 15, priority: "asap", type: "admin", schedule: "work" },
    { title: "Finish Q4 budget review", duration: 150, priority: "high", type: "deep", schedule: "work", deadline: d(2), hardDeadline: true, chunk: 45 },
    { title: "Slides for the quarterly review", duration: 120, priority: "high", type: "meeting", schedule: "work", deadline: d(12), chunk: 60 },
    { title: "Draft blog post on calm productivity", duration: 180, priority: "medium", type: "creative", schedule: "work", deadline: d(7), chunk: 45 },
    { title: "Submit expense report", duration: 45, priority: "medium", type: "admin", schedule: "work", deadline: d(-1) },
    { title: "Review Sam's design proposal", duration: 60, priority: "medium", type: "deep", schedule: "work", deadline: d(4) },
    { title: "Clear the inbox", duration: 30, priority: "low", type: "admin", schedule: "work", repeat: "weekdays" },
    { title: "Book train tickets for the mountains", duration: 20, priority: "high", type: "personal", schedule: "personal", deadline: d(3) },
    { title: "Call Mum about her birthday", duration: 20, priority: "high", type: "personal", schedule: "personal", deadline: d(3) },
    { title: "Renew passport", duration: 60, priority: "medium", type: "errand", schedule: "personal", deadline: d(20), startDate: d(5) },
    { title: "Read two chapters of Piranesi", duration: 60, priority: "low", type: "learning", schedule: "personal", repeat: "weekly" },
    {
      title: "Pay the electricity bill",
      duration: 15,
      priority: "high",
      type: "admin",
      schedule: "work",
      done: { at: today.getTime() - 3_600_000, slots: [{ date: d(0), start: "09:15", end: "09:30" }] },
    },
  ].map((p, i) => t(p as Omit<Task, "id" | "createdAt">, i));
}
