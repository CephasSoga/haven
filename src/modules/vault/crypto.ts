/**
 * Vault encryption. Your master password is stretched with PBKDF2 (SHA-256, 600k rounds) into an
 * AES-256-GCM key that never leaves memory. Only ciphertext is ever written to storage; a wrong
 * password simply fails GCM authentication. Nothing — not even Haven — can recover a lost password.
 */

export const ITERATIONS = 600_000;

export type Sealed = { iv: string; data: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function newSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password: string, salt: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // not extractable
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

/** Throws if the key is wrong or the data was tampered with. */
export async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, key, fromB64(sealed.data));
  return JSON.parse(dec.decode(plain)) as T;
}

/* ---------- Passwords ---------- */

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%^&*-_=+?",
};

/** Uniformly random password from a cryptographic source, guaranteed to use every chosen set. */
export function generatePassword(length = 20, { symbols = true } = {}) {
  const sets = [SETS.lower, SETS.upper, SETS.digits, ...(symbols ? [SETS.symbols] : [])];
  const all = sets.join("");
  const pick = (chars: string) => {
    // Rejection sampling keeps every character equally likely.
    const limit = 256 - (256 % chars.length);
    const buf = new Uint8Array(1);
    do crypto.getRandomValues(buf);
    while (buf[0] >= limit);
    return chars[buf[0] % chars.length];
  };
  for (;;) {
    const pw = Array.from({ length }, () => pick(all)).join("");
    if (sets.every((s) => [...pw].some((c) => s.includes(c)))) return pw;
  }
}

/** Rough strength estimate: 0 (very weak) … 4 (excellent), from length and character variety. */
export function strength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z\d]/.test(pw)) pool += 20;
  let bits = pw.length * Math.log2(Math.max(pool, 1));
  if (/^(.)\1+$/.test(pw) || /(password|qwerty|123456|azerty|letmein)/i.test(pw)) bits = Math.min(bits, 20);
  if (bits < 36) return bits < 24 ? 0 : 1;
  if (bits < 60) return 2;
  if (bits < 90) return 3;
  return 4;
}

export const STRENGTH = [
  { label: "Very weak", color: "var(--neg)" },
  { label: "Weak", color: "#ec7a3c" },
  { label: "Fair", color: "#d99a1e" },
  { label: "Strong", color: "var(--pos)" },
  { label: "Excellent", color: "var(--pos)" },
] as const;
