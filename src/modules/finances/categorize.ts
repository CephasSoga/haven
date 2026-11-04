import { askJson } from "@/lib/ai";
import type { Category, Rule, TxKind } from "./store";

/**
 * Picks a category for an imported line: your own rules first (they're learned from your
 * corrections), then a built-in list of common merchants. Anything left can go to Claude.
 */

const BUILT_IN: Record<string, string[]> = {
  groceries: ["carrefour", "lidl", "aldi", "auchan", "leclerc", "intermarche", "monoprix", "franprix", "casino", "super u", "hyper u", "picard", "biocoop", "naturalia", "tesco", "sainsbury", "asda", "morrisons", "waitrose", "co-op", "walmart", "kroger", "costco", "whole foods", "trader joe", "safeway", "rewe", "edeka", "mercadona", "supermarche", "supermarket", "epicerie", "boulangerie", "bakery", "grocer"],
  dining: ["restaurant", "resto", "brasserie", "bistro", "cafe", "café", "coffee", "starbucks", "mcdonald", "mc do", "burger", "kfc", "subway", "domino", "pizza", "sushi", "kebab", "deliveroo", "uber eats", "ubereats", "just eat", "doordash", "grubhub", "pret a manger", "paul ", "bar ", "pub "],
  transport: ["sncf", "ratp", "navigo", "uber", "bolt", "heetch", "blablacar", "taxi", "lyft", "tfl", "trainline", "eurostar", "ouigo", "air france", "easyjet", "ryanair", "total", "esso", "shell", "bp ", "avia", "carburant", "fuel", "petrol", "station", "parking", "peage", "péage", "autoroute", "vinci", "lime", "velib"],
  utilities: ["edf", "engie", "totalenergies", "veolia", "suez", "eau ", "water", "electric", "gas ", "orange", "sfr", "bouygues", "free mobile", "free telecom", "sosh", "red by", "vodafone", "o2 ", "ee ", "bt ", "verizon", "at&t", "comcast", "internet"],
  housing: ["loyer", "rent", "foncia", "nexity", "syndic", "mortgage", "credit immo", "assurance habitation", "home insurance", "ikea"],
  health: ["pharmacie", "pharmacy", "pharma", "doctolib", "medecin", "médecin", "docteur", "doctor", "dentist", "dentiste", "hopital", "hospital", "clinique", "clinic", "optic", "mutuelle", "boots", "cvs", "walgreens"],
  shopping: ["amazon", "fnac", "darty", "boulanger", "decathlon", "zara", "h&m", "uniqlo", "primark", "sephora", "galeries lafayette", "printemps", "cdiscount", "vinted", "etsy", "ebay", "apple store", "leroy merlin", "castorama", "action ", "kiabi", "argos", "target", "best buy"],
  leisure: ["cinema", "cinéma", "ugc", "pathe", "pathé", "gaumont", "theatre", "théâtre", "concert", "ticketmaster", "fnac spectacles", "museum", "musee", "musée", "steam", "playstation", "xbox", "nintendo", "basic fit", "fitness", "gym", "airbnb", "booking.com", "hotel", "hôtel"],
  subscriptions: ["netflix", "spotify", "deezer", "disney", "canal+", "canal plus", "amazon prime", "prime video", "apple.com/bill", "itunes", "icloud", "google storage", "youtube", "chatgpt", "openai", "anthropic", "claude.ai", "adobe", "microsoft 365", "dropbox", "notion", "patreon", "audible"],
  salary: ["salaire", "salary", "payroll", "paie", "remuneration", "rémunération", "wages"],
  freelance: ["facture client", "invoice", "malt", "upwork", "fiverr", "stripe payout"],
  gifts: ["cadeau", "gift"],
  "other-income": ["remboursement", "refund", "cashback", "interets", "intérêts", "interest", "caf ", "allocation", "impots rembourse"],
};

export type Guess = { categoryId: string; source: "rule" | "built-in" | "none" };

export function guessCategory(description: string, kind: TxKind, rules: Rule[], categories: Category[]): Guess {
  const text = ` ${description.toLowerCase()} `;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const fits = (id: string) => byId.get(id)?.kind === kind;

  // Longest rule first, so "uber eats" beats "uber".
  for (const r of [...rules].sort((a, b) => b.match.length - a.match.length)) {
    if (text.includes(r.match) && fits(r.categoryId)) return { categoryId: r.categoryId, source: "rule" };
  }
  let best: { id: string; len: number } | null = null;
  for (const [id, words] of Object.entries(BUILT_IN)) {
    if (!fits(id)) continue;
    for (const w of words) if (text.includes(w) && (!best || w.length > best.len)) best = { id, len: w.length };
  }
  if (best) return { categoryId: best.id, source: "built-in" };
  return { categoryId: kind === "income" ? "other-income" : "other-expense", source: "none" };
}

/** The part of a description worth remembering as a rule: the merchant's name. */
export function ruleKeyFor(tidyDescription: string) {
  return tidyDescription
    .toLowerCase()
    .replace(/[\d#*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

/** Asks Claude to place lines the rules couldn't. Returns index → category id. */
export async function sortWithClaude(
  lines: { index: number; description: string; amount: number; kind: TxKind }[],
  categories: Category[],
): Promise<Map<number, string>> {
  const expense = categories.filter((c) => c.kind === "expense");
  const income = categories.filter((c) => c.kind === "income");
  const parsed = await askJson<{ assignments: { index: number; category_id: string }[] }>({
    name: "categories",
    system: "You sort bank statement lines into a person's budget categories. Use the merchant name and amount. Money out only goes to expense categories, money in only to income categories. When unsure, use the 'Other' category of the right kind.",
    user: [
      `Expense categories: ${expense.map((c) => `${c.id} (${c.name})`).join(", ")}`,
      `Income categories: ${income.map((c) => `${c.id} (${c.name})`).join(", ")}`,
      "",
      "Lines (index | money in/out | amount | description):",
      ...lines.map((l) => `${l.index} | ${l.kind === "income" ? "in" : "out"} | ${(l.amount / 100).toFixed(2)} | ${l.description}`),
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["assignments"],
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["index", "category_id"],
            properties: { index: { type: "integer" }, category_id: { type: "string", enum: categories.map((c) => c.id) } },
          },
        },
      },
    },
    effort: "low",
    maxTokens: 16000,
  });
  const kindOf = new Map(lines.map((l) => [l.index, l.kind]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out = new Map<number, string>();
  for (const a of parsed.assignments) if (byId.get(a.category_id)?.kind === kindOf.get(a.index)) out.set(a.index, a.category_id);
  return out;
}
