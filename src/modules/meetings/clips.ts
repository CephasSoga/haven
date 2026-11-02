/**
 * The audio behind each transcribed line, kept in IndexedDB on this device only (it isn't synced),
 * so "Improve transcript" can redo it with a bigger model after the meeting. 16 kHz, 16-bit:
 * about 2 MB per minute of speech. Clips are deleted once they've been redone, or with the meeting.
 */

export type Clip = {
  id: string;
  meetingId: string;
  /** ms since the meeting started */
  at: number;
  speaker?: "You" | "Them";
  pcm: Int16Array;
};

const DB = "haven-meetings";
const STORE = "clips";

let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("meeting", "meetingId");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve((req ? req.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}

export function toPcm(audio: Float32Array) {
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) pcm[i] = Math.max(-1, Math.min(1, audio[i])) * 0x7fff;
  return pcm;
}

export function fromPcm(pcm: Int16Array) {
  const audio = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 0x7fff;
  return audio;
}

export const saveClip = (clip: Clip) => tx<void>("readwrite", (s) => s.put(clip));

export async function meetingClips(meetingId: string) {
  const clips = await tx<Clip[]>("readonly", (s) => s.index("meeting").getAll(meetingId));
  return clips.sort((a, b) => a.at - b.at);
}

export const countClips = (meetingId: string) => tx<number>("readonly", (s) => s.index("meeting").count(meetingId));

export const deleteClips = (ids: string[]) => tx<void>("readwrite", (s) => ids.forEach((id) => s.delete(id)));

export async function deleteMeetingClips(meetingId: string) {
  const ids = await tx<IDBValidKey[]>("readonly", (s) => s.index("meeting").getAllKeys(meetingId));
  if (ids.length) await deleteClips(ids as string[]);
}
