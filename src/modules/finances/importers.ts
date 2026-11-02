/**
 * Reading bank statements. Supports the formats banks actually export:
 * CSV (any layout — columns are detected), OFX/QFX, QIF and CAMT.053 (the EU XML statement).
 * Everything happens locally; amounts become signed integer cents (negative = money out).
 */

export type RawTx = {
  /** yyyy-MM-dd */
  date: string;
  /** Signed cents: negative is money leaving the account */
  amount: number;
  description: string;
  /** Stable id from the bank when the format has one (OFX FITID, CAMT reference) */
  bankId?: string;
};

export type DateOrder = "dmy" | "mdy" | "ymd";

export type Mapping = {
  date: number;
  description: number[];
  /** A single signed amount column… */
  amount: number | null;
  /** …or separate money-out / money-in columns */
  debit: number | null;
  credit: number | null;
  dateOrder: DateOrder;
  /** Some card statements list spending as positive numbers */
  flip: boolean;
};

export type Table = { header: string[]; rows: string[][] };

export type Parsed =
  | { kind: "transactions"; format: "OFX" | "QIF" | "CAMT.053"; txs: RawTx[]; currency?: string }
  | { kind: "table"; format: "CSV"; table: Table; mapping: Mapping };

/* ---------- Text decoding ---------- */

/** Banks still export Windows-1252 / Latin-1 a lot; fall back to it when the file isn't valid UTF-8. */
export function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/* ---------- Numbers and dates ---------- */

/** "1 234,56 €", "-12.50", "(45.00)", "12,50-", "1,234.56 DR" → signed cents. */
export function parseAmount(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) (negative = true), (s = s.slice(1, -1));
  if (/\bDR\b|\bD$/i.test(s)) negative = true;
  if (/-\s*$/.test(s)) (negative = true), (s = s.replace(/-\s*$/, ""));
  if (/^\s*[-−–]/.test(s)) (negative = true), (s = s.replace(/^\s*[-−–]/, ""));
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(s) ? s.replace(/,(?=.*,)/g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    normalized = /\.\d{1,2}$/.test(s) ? s.replace(/\.(?=.*\.)/g, "") : s.replace(/\./g, "");
  } else normalized = s;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

const DATE_RE = /^\s*(\d{1,4})[/.\-](\d{1,2})[/.\-'](\d{1,4})/;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number) {
  return y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** Parses a date in the given field order; also understands yyyymmdd and ISO date-times. */
export function parseDate(input: string, order: DateOrder): string | null {
  const s = input.trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact && !/[/.\-]/.test(s.slice(0, 8))) {
    const [y, m, d] = [Number(compact[1]), Number(compact[2]), Number(compact[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  const m = s.match(DATE_RE);
  if (!m) return null;
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let y: number, mo: number, d: number;
  if (m[1].length === 4) [y, mo, d] = [a, b, c];
  else {
    if (m[3].length <= 2) c += c < 70 ? 2000 : 1900;
    y = c;
    [d, mo] = order === "mdy" ? [b, a] : [a, b];
  }
  return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** Looks at many values to decide day-first vs month-first. */
export function guessDateOrder(values: string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    const m = v.trim().match(DATE_RE);
    if (!m) continue;
    if (m[1].length === 4) return "ymd";
    if (Number(m[1]) > 12) dayFirst++;
    if (Number(m[2]) > 12) monthFirst++;
  }
  if (dayFirst || monthFirst) return dayFirst >= monthFirst ? "dmy" : "mdy";
  return navigator.language === "en-US" ? "mdy" : "dmy";
}

/* ---------- CSV ---------- */

function sniffDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const counts = [";", ",", "\t", "|"].map((d) => [d, sample.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
  return rows;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const looksLikeDate = (v: string) => DATE_RE.test(v) || /^\d{8}$/.test(v.trim());
const looksLikeAmount = (v: string) => /^[\s(+\-−]*[\d\s.,]+\d[\s)]*(€|\$|£|eur|usd|gbp|cfa|xaf|fcfa)?\s*-?\s*(dr|cr)?$/i.test(v.trim());

/** Banks often put account details above the real header; find where the table starts. */
function findHeader(rows: string[][]) {
  const width = Math.max(...rows.slice(0, 40).map((r) => r.length));
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (r.length < Math.min(3, width)) continue;
    const next = rows[i + 1];
    const isData = r.some(looksLikeDate) && r.some((v) => looksLikeAmount(v) && !looksLikeDate(v));
    if (isData) return { headerRow: -1, firstData: i };
    if (next && next.length >= r.length - 1 && next.some(looksLikeDate) && !r.some(looksLikeDate)) return { headerRow: i, firstData: i + 1 };
  }
  return { headerRow: 0, firstData: 1 };
}

function guessMapping(table: Table): Mapping {
  const h = table.header.map(norm);
  const cols = table.header.map((_, i) => table.rows.slice(0, 50).map((r) => r[i] ?? ""));
  const find = (re: RegExp, avoid?: RegExp) => h.findIndex((x) => re.test(x) && !(avoid && avoid.test(x)));

  let date = find(/date|datum|fecha|data|booking|posted|operation/, /valeur|value/);
  if (date < 0) date = find(/date/);
  if (date < 0) date = cols.findIndex((c) => c.filter(looksLikeDate).length > c.length * 0.6);

  let debit = find(/debit|withdraw|paid out|money out|depense|sortie|^out$|ausgang|cargo/);
  let credit = find(/credit|deposit|paid in|money in|recette|entree|^in$|eingang|abono/);
  let amount = find(/montant|amount|betrag|importe|valor|^value$|^sum$|somme/);
  if (amount >= 0 && (debit >= 0 || credit >= 0)) (debit = -1), (credit = -1);
  if (amount < 0 && (debit < 0 || credit < 0)) {
    debit = credit = -1;
    amount = cols.findIndex((c, i) => i !== date && c.filter(looksLikeAmount).length > c.length * 0.6);
  }

  const used = new Set([date, amount, debit, credit]);
  let description = h
    .map((x, i) => [x, i] as const)
    .filter(([x, i]) => !used.has(i) && /libelle|description|label|detail|payee|beneficiaire|memo|narrative|merchant|intitule|wording|name|nom|reference|verwendung|concepto|transaction/.test(x))
    .map(([, i]) => i);
  if (!description.length) {
    // Fall back to the column with the longest text on average.
    const avg = cols.map((c, i) => (used.has(i) ? -1 : c.reduce((s, v) => s + (looksLikeAmount(v) ? 0 : v.length), 0) / Math.max(c.length, 1)));
    description = [avg.indexOf(Math.max(...avg))];
  }

  return {
    date: Math.max(date, 0),
    description: description.slice(0, 2),
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 ? debit : null,
    credit: credit >= 0 ? credit : null,
    dateOrder: guessDateOrder(cols[Math.max(date, 0)] ?? []),
    flip: false,
  };
}

export function applyMapping(table: Table, m: Mapping): RawTx[] {
  const out: RawTx[] = [];
  for (const r of table.rows) {
    const date = parseDate(r[m.date] ?? "", m.dateOrder);
    if (!date) continue;
    let amount: number | null;
    if (m.amount !== null) amount = parseAmount(r[m.amount] ?? "");
    else {
      const out_ = m.debit !== null ? parseAmount(r[m.debit] ?? "") : null;
      const in_ = m.credit !== null ? parseAmount(r[m.credit] ?? "") : null;
      amount = out_ ? -Math.abs(out_) : in_ ? Math.abs(in_) : null;
    }
    if (!amount) continue;
    const description = m.description.map((i) => r[i] ?? "").filter(Boolean).join(" — ");
    out.push({ date, amount: m.flip ? -amount : amount, description });
  }
  return out;
}

/* ---------- OFX / QFX ---------- */

function tag(block: string, name: string) {
  // OFX 1.x (SGML) often leaves tags unclosed; read up to the next tag or line end.
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

function parseOfx(text: string): RawTx[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  return blocks
    .map((b): RawTx | null => {
      const date = parseDate(tag(b, "DTPOSTED"), "ymd");
      const amount = parseAmount(tag(b, "TRNAMT"));
      const name = tag(b, "NAME");
      const memo = tag(b, "MEMO");
      return date && amount
        ? { date, amount, description: [name, memo && memo !== name ? memo : ""].filter(Boolean).join(" — "), bankId: tag(b, "FITID") || undefined }
        : null;
    })
    .filter((t): t is RawTx => !!t);
}

/* ---------- QIF ---------- */

function parseQif(text: string): RawTx[] {
  const entries = text.split(/^\^\s*$/m);
  const raw = entries.map((e) => {
    const get = (c: string) => e.match(new RegExp(`^${c}(.*)$`, "m"))?.[1].trim() ?? "";
    return { d: get("D"), t: get("T") || get("U"), p: get("P"), m: get("M") };
  });
  const order = guessDateOrder(raw.map((r) => r.d.replace("'", "/")));
  return raw
    .map((r) => {
      const date = parseDate(r.d.replace("'", "/"), order);
      const amount = parseAmount(r.t);
      return date && amount ? { date, amount, description: [r.p, r.m && r.m !== r.p ? r.m : ""].filter(Boolean).join(" — ") } : null;
    })
    .filter((t): t is RawTx => !!t);
}

/* ---------- CAMT.053 (ISO 20022) ---------- */

function xmlText(block: string, path: string) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${path}[^>]*>([^<]*)<`, "i"));
  return m ? m[1].trim() : "";
}

function parseCamt(text: string): { txs: RawTx[]; currency?: string } {
  const entries = text.split(/<(?:\w+:)?Ntry>/i).slice(1);
  let currency: string | undefined;
  const txs = entries
    .map((e) => {
      const amt = e.match(/<(?:\w+:)?Amt[^>]*Ccy="(\w+)"[^>]*>([^<]+)</i);
      if (!amt) return null;
      currency ??= amt[1];
      const value = parseAmount(amt[2]);
      const debit = /<(?:\w+:)?CdtDbtInd>\s*DBIT/i.test(e);
      const booked = e.split(/<(?:\w+:)?BookgDt>/i)[1] ?? e;
      const date = parseDate(xmlText(booked, "Dt") || xmlText(booked, "DtTm"), "ymd");
      if (!date || !value) return null;
      // The other party: who we paid (debit) or who paid us (credit).
      const party = (debit ? e.split(/<(?:\w+:)?Cdtr>/i)[1] : e.split(/<(?:\w+:)?Dbtr>/i)[1]) ?? "";
      const name = party ? xmlText(party, "Nm") : "";
      const info = xmlText(e, "Ustrd") || xmlText(e, "AddtlNtryInf");
      return {
        date,
        amount: debit ? -Math.abs(value) : Math.abs(value),
        description: [name, info && info !== name ? info : ""].filter(Boolean).join(" — "),
        bankId: xmlText(e, "AcctSvcrRef") || xmlText(e, "NtryRef") || undefined,
      };
    })
    .filter((t): t is NonNullable<typeof t> => !!t);
  return { txs, currency };
}

/* ---------- Entry point ---------- */

export function parseStatement(text: string, filename: string): Parsed {
  const name = filename.toLowerCase();
  if (/<OFX>|OFXHEADER/i.test(text) || /\.(ofx|qfx)$/.test(name)) return { kind: "transactions", format: "OFX", txs: parseOfx(text) };
  if (/BkToCstmrStmt|camt\.05[234]/i.test(text)) {
    const { txs, currency } = parseCamt(text);
    return { kind: "transactions", format: "CAMT.053", txs, currency };
  }
  if (/^!Type:/im.test(text) || name.endsWith(".qif")) return { kind: "transactions", format: "QIF", txs: parseQif(text) };

  const rows = parseCsv(text);
  if (!rows.length) throw new Error("This file is empty.");
  const { headerRow, firstData } = findHeader(rows);
  const width = Math.max(...rows.slice(firstData, firstData + 30).map((r) => r.length));
  const header = headerRow >= 0 ? rows[headerRow] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const table: Table = { header, rows: rows.slice(firstData).filter((r) => r.length >= Math.min(2, width)) };
  return { kind: "table", format: "CSV", table, mapping: guessMapping(table) };
}

/* ---------- Making descriptions readable ---------- */

const NOISE =
  /\b(paiement|achat|achats|prlv|prelevement|prélèvement|sepa|sdd|cb|carte|card|payment|purchase|pos|debit|visa|mastercard|contactless|sans contact|vir|virement|inst|instantane|transfer|facture|ref|réf|mandat|ech|echeance|faveur)\b/gi;

// Short words that are ordinary words, not acronyms, when a description is in capitals.
const SMALL_WORDS = new Set(["le", "la", "les", "de", "du", "des", "et", "au", "aux", "a", "à", "en", "the", "of", "and", "for", "to", "on", "at", "by", "co"]);
// Common short words that would otherwise look like acronyms.
const COMMON_SHORT = new Set(["oil", "gas", "bar", "pub", "inn", "spa", "gym", "art", "tea", "car", "bus", "bio", "eco", "new", "old", "big", "top", "net", "web", "app", "pay", "bay", "box", "day", "sun", "sea", "bon", "chez", "rue", "vin", "pain"]);

/** "PAIEMENT CB 0211 CARREFOUR CITY PARIS CARTE 4974XXXX1234" → "Carrefour City Paris" */
export function tidy(description: string): string {
  const raw = description.split(" — ")[0] || description;
  let s = raw
    .replace(/\b\d{2}[/.]\d{2}([/.]\d{2,4})?\b/g, " ")
    .replace(/\b[\dX*]{4,}\d{2,}\b|\bX+\d{3,}\b|\*+\d+/gi, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(NOISE, " ")
    .replace(/[_*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 2) s = raw.trim();
  if (s === s.toUpperCase()) {
    // Title-case shouting, but keep short acronyms (EDF, SAS, SNCF) as they are.
    s = s
      .split(" ")
      .map((w, i) => {
        const lower = w.toLowerCase();
        const acronym = /^\p{L}+$/u.test(w) && !SMALL_WORDS.has(lower) && !COMMON_SHORT.has(lower) && (w.length <= 3 || !/[aeiouy]/i.test(w));
        if (acronym) return w;
        if (i > 0 && SMALL_WORDS.has(lower)) return lower;
        return lower.replace(/(^|[\-/'(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
      })
      .join(" ");
  }
  return s
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[,;:\-\s]+$/, "")
    .slice(0, 80);
}

/** A key for spotting the same bank line again in a later import. */
export function fingerprint(t: RawTx) {
  return `${t.date}|${t.amount}|${norm(t.description).replace(/[^a-z0-9]/g, "").slice(0, 40)}`;
}
