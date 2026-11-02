import { median } from "./stats";
import { step, type Cycle, type Subscription } from "./store";
import { dayKey, parseDay, todayKey } from "@/lib/dates";
import type { Transaction } from "@/modules/finances/store";

/** Well-known services: one tap fills in the name, category, look and website. Prices vary by country, so you enter those. */
export type Service = { name: string; match: string[]; category: string; color: string; emoji: string; url: string };

export const SERVICES: Service[] = [
  { name: "Netflix", match: ["netflix"], category: "streaming", color: "rose", emoji: "🎬", url: "https://www.netflix.com" },
  { name: "Disney+", match: ["disney"], category: "streaming", color: "blue", emoji: "🏰", url: "https://www.disneyplus.com" },
  { name: "Prime Video / Amazon Prime", match: ["amazon prime", "prime video", "amzn prime"], category: "shopping", color: "blue", emoji: "📦", url: "https://www.amazon.com/prime" },
  { name: "YouTube Premium", match: ["youtube"], category: "streaming", color: "rose", emoji: "▶️", url: "https://www.youtube.com/premium" },
  { name: "Canal+", match: ["canal+", "canal plus", "canalplus"], category: "streaming", color: "slate", emoji: "📺", url: "https://www.canalplus.com" },
  { name: "Apple TV+", match: ["apple tv"], category: "streaming", color: "slate", emoji: "🍎", url: "https://tv.apple.com" },
  { name: "Spotify", match: ["spotify"], category: "music", color: "green", emoji: "🎧", url: "https://www.spotify.com" },
  { name: "Deezer", match: ["deezer"], category: "music", color: "violet", emoji: "🎵", url: "https://www.deezer.com" },
  { name: "Apple Music", match: ["apple music"], category: "music", color: "rose", emoji: "🎵", url: "https://music.apple.com" },
  { name: "Audible", match: ["audible"], category: "music", color: "orange", emoji: "📚", url: "https://www.audible.com" },
  { name: "iCloud+", match: ["icloud", "apple.com/bill", "apple.com bill"], category: "cloud", color: "blue", emoji: "☁️", url: "https://www.icloud.com" },
  { name: "Google One", match: ["google one", "google storage"], category: "cloud", color: "blue", emoji: "☁️", url: "https://one.google.com" },
  { name: "Dropbox", match: ["dropbox"], category: "cloud", color: "blue", emoji: "📁", url: "https://www.dropbox.com" },
  { name: "Microsoft 365", match: ["microsoft 365", "office 365", "msft"], category: "software", color: "orange", emoji: "🪟", url: "https://www.microsoft.com/microsoft-365" },
  { name: "Adobe Creative Cloud", match: ["adobe"], category: "software", color: "rose", emoji: "🎨", url: "https://www.adobe.com" },
  { name: "Notion", match: ["notion"], category: "software", color: "slate", emoji: "📝", url: "https://www.notion.com" },
  { name: "Figma", match: ["figma"], category: "software", color: "violet", emoji: "🖌️", url: "https://www.figma.com" },
  { name: "GitHub", match: ["github"], category: "software", color: "slate", emoji: "🐙", url: "https://github.com" },
  { name: "1Password", match: ["1password", "agilebits"], category: "software", color: "blue", emoji: "🔐", url: "https://1password.com" },
  { name: "Claude", match: ["claude.ai", "anthropic"], category: "ai", color: "orange", emoji: "✨", url: "https://claude.ai" },
  { name: "ChatGPT", match: ["chatgpt", "openai"], category: "ai", color: "teal", emoji: "🤖", url: "https://chatgpt.com" },
  { name: "Le Monde", match: ["le monde"], category: "news", color: "slate", emoji: "📰", url: "https://www.lemonde.fr" },
  { name: "The New York Times", match: ["nytimes", "ny times", "new york times"], category: "news", color: "slate", emoji: "📰", url: "https://www.nytimes.com" },
  { name: "Medium", match: ["medium.com"], category: "news", color: "slate", emoji: "✍️", url: "https://medium.com" },
  { name: "Xbox Game Pass", match: ["xbox", "game pass"], category: "gaming", color: "green", emoji: "🎮", url: "https://www.xbox.com" },
  { name: "PlayStation Plus", match: ["playstation", "psn"], category: "gaming", color: "blue", emoji: "🎮", url: "https://www.playstation.com" },
  { name: "Nintendo Switch Online", match: ["nintendo"], category: "gaming", color: "rose", emoji: "🍄", url: "https://www.nintendo.com" },
  { name: "Strava", match: ["strava"], category: "fitness", color: "orange", emoji: "🚴", url: "https://www.strava.com" },
  { name: "Headspace", match: ["headspace"], category: "fitness", color: "amber", emoji: "🧘", url: "https://www.headspace.com" },
  { name: "Basic-Fit", match: ["basic fit", "basic-fit", "basicfit"], category: "fitness", color: "amber", emoji: "🏋️", url: "https://www.basic-fit.com" },
  { name: "Duolingo", match: ["duolingo"], category: "learning", color: "green", emoji: "🦉", url: "https://www.duolingo.com" },
  { name: "Coursera", match: ["coursera"], category: "learning", color: "blue", emoji: "🎓", url: "https://www.coursera.org" },
  { name: "Uber One", match: ["uber one"], category: "shopping", color: "slate", emoji: "🚗", url: "https://www.uber.com" },
  { name: "Deliveroo Plus", match: ["deliveroo plus"], category: "shopping", color: "teal", emoji: "🛵", url: "https://deliveroo.com" },
];

export function findService(text: string) {
  const t = text.toLowerCase();
  return SERVICES.find((s) => s.match.some((m) => t.includes(m)));
}

/* ---------- Spotting subscriptions in your bank transactions ---------- */

export type Suggestion = {
  key: string;
  name: string;
  price: number;
  cycle: Cycle;
  last: string;
  next: string;
  seen: number;
  service?: Service;
};

const EVERYDAY = new Set(["housing", "groceries", "dining", "transport", "health"]);

const normalize = (note: string) =>
  note
    .toLowerCase()
    .replace(/[\d#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function cycleFor(days: number): Cycle | null {
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 26 && days <= 35) return "monthly";
  if (days >= 85 && days <= 95) return "quarterly";
  if (days >= 355 && days <= 375) return "yearly";
  return null;
}

/**
 * Looks for charges that repeat on a steady rhythm with a steady amount (or come from a
 * well-known subscription service) and that you're not already tracking.
 */
export function detect(transactions: Transaction[], subs: Subscription[], dismissed: string[]): Suggestion[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.kind !== "expense" || !t.note) continue;
    const key = normalize(t.note);
    if (key.length < 3) continue;
    // Rent, food and travel repeat too, but they aren't online services.
    if (EVERYDAY.has(t.categoryId) && !findService(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const tracked = subs.map((s) => s.name.toLowerCase());
  const isTracked = (key: string, service?: Service) =>
    tracked.some((n) => key.includes(n) || n.includes(key) || (service && service.match.some((m) => n.includes(m) || n.includes(service.name.toLowerCase()))));

  const today = todayKey();
  const out: Suggestion[] = [];
  for (const [key, txs] of groups) {
    if (dismissed.includes(key)) continue;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const service = findService(key);
    if (isTracked(key, service)) continue;

    let cycle: Cycle | null = null;
    if (sorted.length >= 2) {
      const gaps = sorted.slice(1).map((t, i) => (parseDay(t.date).getTime() - parseDay(sorted[i].date).getTime()) / 86_400_000);
      const amounts = sorted.map((t) => t.amount);
      const steady = Math.max(...amounts) / Math.max(1, Math.min(...amounts)) <= 1.25;
      cycle = steady ? cycleFor(median(gaps)) : null;
    }
    // A single recent charge from a known subscription service is worth a mention too.
    if (!cycle && service && (parseDay(today).getTime() - parseDay(last.date).getTime()) / 86_400_000 <= 45) cycle = "monthly";
    if (!cycle) continue;

    let next = step(parseDay(last.date), cycle);
    while (dayKey(next) < today) next = step(next, cycle);
    out.push({
      key,
      name: service?.name ?? last.note!.replace(/\s+/g, " ").trim(),
      price: last.amount,
      cycle,
      last: last.date,
      next: dayKey(next),
      seen: sorted.length,
      service,
    });
  }
  return out.sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
}
