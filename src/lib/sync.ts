import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { ask } from "@/components/confirm";
import { supabase, type Account } from "@/lib/cloud";
import { showNotice } from "@/lib/notices";
import { useSettings } from "@/store/settings";
import { useCalendar } from "@/modules/calendar/store";
import { useFinance } from "@/modules/finances/store";
import { useNotes } from "@/modules/notes/store";
import { useLibrary } from "@/modules/library/store";
import { clearFiles, getFile, putFile } from "@/modules/library/files";
import { useFeed } from "@/modules/feed/store";
import { useMeetings } from "@/modules/meetings/store";
import { useSubscriptions } from "@/modules/subscriptions/store";
import { readVaultFile, useVault, type VaultFile } from "@/modules/vault/store";

/**
 * Keeps this device and your account in step.
 *
 * Each part of Haven is one document (the same JSON it keeps in this browser's storage).
 * Local changes are uploaded a moment after they happen; changes from your other devices
 * arrive live and replace the local copy when they're newer. The vault travels exactly as
 * stored — encrypted with your master password — and book files go to private storage.
 *
 * What stays on this device: your Anthropic API key, the sign-in session, display preferences.
 */

type PersistedStore = { subscribe: (fn: () => void) => () => void; persist: { rehydrate: () => Promise<void> | void } };

const STORES: Record<string, PersistedStore> = {
  "haven:settings": useSettings,
  "haven:calendar": useCalendar,
  "haven:finances": useFinance,
  "haven:notes": useNotes,
  "haven:library": useLibrary,
  "haven:feed": useFeed,
  "haven:meetings": useMeetings,
  "haven:subscriptions": useSubscriptions,
};
const VAULT = "haven:vault";
const KEYS = [...Object.keys(STORES), VAULT];

const META_KEY = "haven:sync";
const DEVICE_KEY = "haven:device";

type Meta = { userId?: string; docs: Record<string, { localAt: number; cloudAt: number }> };

export type SyncState = { phase: "idle" | "syncing" | "offline" | "error"; lastSync: number | null; message?: string };
export const useSync = create<SyncState>()(() => ({ phase: "idle", lastSync: null }));

function device() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
  return id;
}

function readMeta(): Meta {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? "") as Meta;
  } catch {
    return { docs: {} };
  }
}
const writeMeta = (m: Meta) => localStorage.setItem(META_KEY, JSON.stringify(m));

let account: Account | null = null;
let channel: RealtimeChannel | null = null;
let unsubscribers: (() => void)[] = [];
let lastRaw: Record<string, string | null> = {};
let applying = false;
let flushTimer: number | undefined;
let retryTimer: number | undefined;
// Bumped on every start and stop, so a start that's still waiting on the network gives up once it's stale.
let run = 0;

/* ---------- Pushing local changes ---------- */

function markChanged(key: string) {
  const meta = readMeta();
  meta.docs[key] = { localAt: Date.now(), cloudAt: meta.docs[key]?.cloudAt ?? 0 };
  writeMeta(meta);
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 1500);
}

function watch(key: string) {
  const raw = localStorage.getItem(key);
  if (raw === lastRaw[key]) return;
  lastRaw[key] = raw;
  if (!applying) markChanged(key);
}

/** Uploads every document changed since it was last saved to the account. */
export async function flush() {
  if (!supabase || !account) return;
  const meta = readMeta();
  const dirty = KEYS.filter((k) => (meta.docs[k]?.localAt ?? 0) > (meta.docs[k]?.cloudAt ?? 0) && localStorage.getItem(k) !== null);
  if (!dirty.length) return;
  if (!navigator.onLine) return useSync.setState({ phase: "offline" });
  useSync.setState({ phase: "syncing" });
  const rows = dirty.map((k) => ({
    user_id: account!.id,
    key: k,
    data: JSON.parse(localStorage.getItem(k)!),
    updated_at: new Date(meta.docs[k].localAt).toISOString(),
    device: device(),
  }));
  const { error } = await supabase.from("documents").upsert(rows, { onConflict: "user_id,key" });
  if (error) {
    useSync.setState({ phase: navigator.onLine ? "error" : "offline", message: error.message });
    clearTimeout(retryTimer);
    retryTimer = window.setTimeout(flush, 30_000);
    return;
  }
  const after = readMeta();
  for (const r of rows) after.docs[r.key] = { localAt: Date.parse(r.updated_at), cloudAt: Date.parse(r.updated_at) };
  writeMeta(after);
  useSync.setState({ phase: "idle", lastSync: Date.now(), message: undefined });
}

/* ---------- Applying changes from the account ---------- */

type Row = { key: string; data: unknown; updated_at: string; device: string | null };

async function apply(row: Row) {
  if (!KEYS.includes(row.key)) return;
  const at = Date.parse(row.updated_at);
  const raw = JSON.stringify(row.data);
  applying = true;
  try {
    localStorage.setItem(row.key, raw);
    lastRaw[row.key] = raw;
    const meta = readMeta();
    meta.docs[row.key] = { localAt: at, cloudAt: at };
    writeMeta(meta);
    // The vault re-locks when another device changed it; unlock to see the new contents.
    if (row.key === VAULT) useVault.getState().restore(row.data as VaultFile);
    else await STORES[row.key].persist.rehydrate();
  } finally {
    applying = false;
  }
}

function newer(row: Row) {
  const d = readMeta().docs[row.key];
  return !d || Date.parse(row.updated_at) > Math.max(d.localAt, d.cloudAt);
}

async function pullAll(): Promise<Row[]> {
  const { data, error } = await supabase!.from("documents").select("key,data,updated_at,device");
  if (error) throw error;
  return (data ?? []) as Row[];
}

/* ---------- Starting and stopping ---------- */

const hasLocalData = () =>
  useCalendar.getState().events.length +
    useCalendar.getState().tasks.length +
    useFinance.getState().transactions.length +
    useNotes.getState().notes.length +
    useLibrary.getState().books.length +
    useMeetings.getState().meetings.length +
    useSubscriptions.getState().subs.length >
    0 || !!readVaultFile();

/** Called once signed in: reconciles this device with the account, then keeps them in step. */
export async function startSync(acc: Account) {
  if (!supabase) return;
  stopSync();
  const mine = ++run;
  account = acc;
  useSync.setState({ phase: "syncing" });
  for (const k of KEYS) lastRaw[k] = localStorage.getItem(k);

  try {
    const rows = await pullAll();
    if (mine !== run) return;
    const meta = readMeta();
    if (meta.userId !== acc.id) {
      // First time this account is used on this device.
      // Closing the question without choosing keeps the account's copy, the one your other devices share.
      const keepDevice =
        rows.length === 0 ||
        (hasLocalData() &&
          (await ask({
            title: "Which data should Haven keep?",
            body: "This device already has Haven data, and so does your account. Use the account's data (this device's copy is replaced), or keep this device's data (the account's copy is replaced on every device).",
            confirmLabel: "Keep this device's data",
            cancelLabel: "Use my account's data",
            danger: true,
          })));
      writeMeta({ userId: acc.id, docs: {} });
      if (keepDevice) {
        for (const k of KEYS) if (localStorage.getItem(k) !== null) markChanged(k);
        void uploadAllBooks();
      } else for (const r of rows) await apply(r);
    } else {
      for (const r of rows) if (newer(r)) await apply(r);
    }
    // Anything on this device that has never reached the account goes up now.
    const synced = readMeta().docs;
    const inCloud = new Set(rows.map((r) => r.key));
    for (const k of KEYS) if (localStorage.getItem(k) !== null && !synced[k] && !inCloud.has(k)) markChanged(k);
    await flush();
    if (mine !== run) return;
    useSync.setState({ phase: "idle", lastSync: Date.now() });
  } catch (e) {
    if (mine !== run) return;
    useSync.setState({ phase: navigator.onLine ? "error" : "offline", message: e instanceof Error ? e.message : String(e) });
  }

  // Watch local changes. Stores tell their listeners before they save, so look once the save is done.
  for (const [k, store] of Object.entries(STORES)) unsubscribers.push(store.subscribe(() => queueMicrotask(() => watch(k))));
  unsubscribers.push(useVault.subscribe(() => queueMicrotask(() => watch(VAULT))));
  // Haven open in several tabs: a change saved in one shows up in the others.
  const otherTab = (e: StorageEvent) => {
    if (!e.key || !(e.key in STORES) || e.newValue === null) return;
    lastRaw[e.key] = e.newValue;
    void STORES[e.key].persist.rehydrate();
  };
  window.addEventListener("storage", otherTab);
  unsubscribers.push(() => window.removeEventListener("storage", otherTab));
  // …and your other devices.
  channel = supabase
    // A fresh name each time: the old channel may still be closing when a new one opens.
    .channel(`documents-${acc.id}-${mine}-${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `user_id=eq.${acc.id}` }, (payload) => {
      const row = payload.new as Row;
      if (!row?.key || row.device === device() || !newer(row)) return;
      void apply(row).then(() => useSync.setState({ lastSync: Date.now() }));
    })
    .subscribe();

  const online = () => void flush();
  window.addEventListener("online", online);
  unsubscribers.push(() => window.removeEventListener("online", online));
  const visible = () => document.visibilityState === "visible" && void catchUp();
  document.addEventListener("visibilitychange", visible);
  unsubscribers.push(() => document.removeEventListener("visibilitychange", visible));
}

/** After being away (laptop asleep, app in background), fetch anything missed. */
async function catchUp() {
  if (!account) return;
  try {
    for (const r of await pullAll()) if (newer(r) && r.device !== device()) await apply(r);
    await flush();
    useSync.setState({ phase: "idle", lastSync: Date.now() });
  } catch {
    useSync.setState({ phase: navigator.onLine ? "error" : "offline" });
  }
}

export const syncNow = catchUp;

export function stopSync() {
  run++;
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  clearTimeout(flushTimer);
  clearTimeout(retryTimer);
  account = null;
}

/** Signing out: save what's pending, then remove this account's data from the device. */
export async function signOutAndClear(endSession: () => Promise<void>) {
  await flush().catch(() => {});
  stopSync();
  for (const k of [...KEYS, META_KEY]) localStorage.removeItem(k);
  await clearFiles().catch(() => {});
  await endSession();
  // A clean reload resets every module's in-memory state.
  location.reload();
}

/* ---------- Library book files ---------- */

const bookPath = (id: string) => `${account!.id}/${id}`;

/** Why a book's file didn't reach, or couldn't be fetched from, your account. */
export class BookTransferError extends Error {
  constructor(
    public reason: "too-large" | "offline" | "not-in-account" | "failed",
    message: string,
  ) {
    super(message);
  }
}

const describeStorageError = (error: { message?: string; statusCode?: string | number }, verb: "upload" | "download") => {
  const status = String((error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status ?? "");
  if (!navigator.onLine) return new BookTransferError("offline", "You're offline.");
  if (status === "413" || /maximum allowed size|too large|payload/i.test(error.message ?? ""))
    return new BookTransferError("too-large", "The file is larger than your account allows for one book.");
  if (verb === "download" && (status === "404" || status === "400" || /not.?found/i.test(error.message ?? "")))
    return new BookTransferError("not-in-account", "This book's file never reached your account.");
  return new BookTransferError("failed", error.message || `The ${verb} didn't go through.`);
};

/** Saves a book's file to your account so your other devices can open it. Throws a BookTransferError if it can't. */
export async function uploadBook(id: string, file: Blob) {
  if (!supabase || !account) return;
  let result;
  try {
    result = await supabase.storage.from("books").upload(bookPath(id), file, { upsert: true, contentType: file.type || "application/octet-stream" });
  } catch (e) {
    throw describeStorageError({ message: e instanceof Error ? e.message : String(e) }, "upload");
  }
  if (result.error) throw describeStorageError(result.error, "upload");
}

/** Fetches a book's file from the account when this device doesn't have it yet. Throws a BookTransferError if it can't. */
export async function downloadBook(id: string): Promise<Blob | undefined> {
  if (!supabase || !account) return undefined;
  let result;
  try {
    result = await supabase.storage.from("books").download(bookPath(id));
  } catch (e) {
    throw describeStorageError({ message: e instanceof Error ? e.message : String(e) }, "download");
  }
  if (result.error || !result.data) throw describeStorageError(result.error ?? {}, "download");
  await putFile(id, result.data);
  return result.data;
}

export async function deleteBook(id: string) {
  if (!supabase || !account) return;
  await supabase.storage.from("books").remove([bookPath(id)]);
}

async function uploadAllBooks() {
  const tooLarge: string[] = [];
  for (const b of useLibrary.getState().books) {
    const file = await getFile(b.id).catch(() => undefined);
    if (file) await uploadBook(b.id, file).catch((e) => e instanceof BookTransferError && e.reason === "too-large" && tooLarge.push(b.title));
  }
  if (tooLarge.length) bookTooLarge(tooLarge);
}

/** Books that are too big for the account stay on this device only — say so once, by name. */
export function bookTooLarge(titles: string[]) {
  showNotice({
    id: `too-large:${titles.join("|")}`,
    tone: "warning",
    title: titles.length === 1 ? `“${titles[0]}” is too large to sync` : `${titles.length} books are too large to sync`,
    body: `${titles.length === 1 ? "It's" : `${titles.join(", ")} are`} kept on this device and can be read here, but won't appear on your other devices.`,
    sticky: true,
  });
}
