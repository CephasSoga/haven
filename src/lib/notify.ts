import { useEffect, useMemo } from "react";
import { inApp, onAndroid } from "@/lib/platform";
import { formatMoney } from "@/lib/money";
import { upcomingReminders, type Reminder } from "@/lib/reminders";
import { useSettings } from "@/store/settings";
import { useCalendar } from "@/modules/calendar/store";
import { useNow, usePlan } from "@/modules/calendar/plan";
import { useFinance } from "@/modules/finances/store";
import { useSubscriptions } from "@/modules/subscriptions/store";

type NotificationApi = typeof import("@tauri-apps/plugin-notification");
let api: Promise<NotificationApi> | null = null;
const plugin = () => (api ??= import("@tauri-apps/plugin-notification"));

const CHANNEL = "reminders";
const SCHEDULED = "haven:reminders-scheduled";
const SHOWN = "haven:reminders-shown";

export type Permission = "granted" | "denied" | "default" | "unsupported";

export async function notificationPermission(): Promise<Permission> {
  if (inApp) return (await (await plugin()).isPermissionGranted()) ? "granted" : "default";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function askNotificationPermission(): Promise<Permission> {
  if (inApp) return (await (await plugin()).requestPermission()) as Permission;
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

/** Shows a notification right away. */
export async function notify(title: string, body: string) {
  if (inApp) {
    const n = await plugin();
    if (onAndroid) await ensureChannel(n);
    n.sendNotification({ title, body, channelId: onAndroid ? CHANNEL : undefined });
  } else if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.svg" });
  }
}

let channelReady = false;
async function ensureChannel(n: NotificationApi) {
  if (channelReady) return;
  await n.createChannel({ id: CHANNEL, name: "Reminders", description: "Events, bills and renewals", importance: n.Importance.High, vibration: true }).catch(() => {});
  channelReady = true;
}

const readIds = (key: string): number[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
};

/** Android: hand the next reminders to the system, so they arrive even while Haven is closed. */
async function scheduleOnPhone(list: Reminder[]) {
  const n = await plugin();
  if (!(await n.isPermissionGranted())) return;
  await ensureChannel(n);
  const previous = readIds(SCHEDULED);
  if (previous.length) await n.cancel(previous).catch(() => {});
  // The system keeps a limited number of alarms per app; the next 60 cover about a week.
  const next = list.slice(0, 60);
  for (const r of next) n.sendNotification({ id: r.id, title: r.title, body: r.body, channelId: CHANNEL, schedule: n.Schedule.at(new Date(r.at), false, true) });
  localStorage.setItem(SCHEDULED, JSON.stringify(next.map((r) => r.id)));
}

/** Computer and browser: show reminders whose time has come while Haven is open. */
function showDue(list: Reminder[], now: number) {
  const shown = new Set(readIds(SHOWN));
  // Anything more than two minutes late was missed while Haven was closed; skip it rather than pile up.
  const due = list.filter((r) => r.at <= now && r.at > now - 2 * 60_000 && !shown.has(r.id));
  if (!due.length) return;
  for (const r of due) {
    void notify(r.title, r.body);
    shown.add(r.id);
  }
  localStorage.setItem(SHOWN, JSON.stringify([...shown].slice(-300)));
}

/** Keeps reminders for events, planned tasks, bills and subscriptions in step with your data. */
export function useReminders() {
  const prefs = useSettings((s) => s.reminders);
  const currency = useSettings((s) => s.currency);
  const events = useCalendar((s) => s.events);
  const tasks = useCalendar((s) => s.tasks);
  const plan = usePlan();
  const bills = useFinance((s) => s.bills);
  const subs = useSubscriptions((s) => s.subs);
  const now = useNow();
  // The list only needs rebuilding when the data changes or the clock passes into a new minute.
  const minute = Math.floor(now.getTime() / 60_000);

  const list = useMemo(
    () => upcomingReminders({ now: new Date(minute * 60_000), prefs, events, tasks, plan, bills, subs, money: (c) => formatMoney(c, currency) }),
    [minute, prefs, events, tasks, plan, bills, subs, currency],
  );
  const signature = list.map((r) => `${r.id}@${r.at}`).join(",");

  // Phone: reschedule whenever the set of reminders changes (shortly after, so typing doesn't thrash).
  useEffect(() => {
    if (!(inApp && onAndroid)) return;
    const t = setTimeout(() => void scheduleOnPhone(list).catch(() => {}), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Computer and browser: check every 20 seconds.
  useEffect(() => {
    if (inApp && onAndroid) return;
    const check = () => showDue(list, Date.now());
    check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, [list]);

  // Ask once on the phone, where Android 13+ needs permission before anything can show.
  useEffect(() => {
    if (!(inApp && onAndroid) || localStorage.getItem("haven:reminders-asked")) return;
    localStorage.setItem("haven:reminders-asked", "1");
    void notificationPermission().then(async (p) => {
      if (p !== "granted" && (await askNotificationPermission()) === "granted") await scheduleOnPhone(list);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
