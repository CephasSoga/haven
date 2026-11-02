import { Bitcoin, CreditCard, FileKey2, IdCard, KeyRound, Landmark, NotebookTabs, Wifi, type LucideIcon } from "lucide-react";

export type FieldDef = {
  key: string;
  label: string;
  /** Hidden until revealed, and checked for strength when it's a password */
  secret?: boolean;
  password?: boolean;
  multiline?: boolean;
  placeholder?: string;
  type?: "text" | "url" | "date" | "email";
};

export type KindDef = { label: string; plural: string; icon: LucideIcon; color: string; fields: FieldDef[] };

export type Kind = "login" | "card" | "bank" | "identity" | "wallet" | "wifi" | "license" | "note";

export const KINDS: Record<Kind, KindDef> = {
  login: {
    label: "Login",
    plural: "Logins",
    icon: KeyRound,
    color: "violet",
    fields: [
      { key: "username", label: "Username or email", placeholder: "you@example.com" },
      { key: "password", label: "Password", secret: true, password: true },
      { key: "url", label: "Website", type: "url", placeholder: "https://" },
    ],
  },
  card: {
    label: "Card",
    plural: "Cards",
    icon: CreditCard,
    color: "blue",
    fields: [
      { key: "holder", label: "Name on card" },
      { key: "number", label: "Card number", secret: true, placeholder: "1234 5678 9012 3456" },
      { key: "expiry", label: "Expires", placeholder: "MM/YY" },
      { key: "cvv", label: "Security code", secret: true, placeholder: "CVV" },
      { key: "pin", label: "PIN", secret: true },
    ],
  },
  bank: {
    label: "Bank account",
    plural: "Bank accounts",
    icon: Landmark,
    color: "teal",
    fields: [
      { key: "bank", label: "Bank" },
      { key: "holder", label: "Account holder" },
      { key: "iban", label: "IBAN / account number", secret: true },
      { key: "bic", label: "BIC / SWIFT / routing" },
    ],
  },
  identity: {
    label: "ID & document",
    plural: "IDs & documents",
    icon: IdCard,
    color: "amber",
    fields: [
      { key: "document", label: "Document", placeholder: "Passport, ID card, driving licence…" },
      { key: "number", label: "Number", secret: true },
      { key: "issued", label: "Issued", type: "date" },
      { key: "expires", label: "Expires", type: "date" },
    ],
  },
  wallet: {
    label: "Crypto wallet",
    plural: "Crypto wallets",
    icon: Bitcoin,
    color: "orange",
    fields: [
      { key: "network", label: "Network", placeholder: "Bitcoin, Ethereum…" },
      { key: "address", label: "Public address" },
      { key: "seed", label: "Recovery phrase", secret: true, multiline: true },
    ],
  },
  wifi: {
    label: "Wi-Fi",
    plural: "Wi-Fi networks",
    icon: Wifi,
    color: "green",
    fields: [
      { key: "network", label: "Network name" },
      { key: "password", label: "Password", secret: true, password: true },
    ],
  },
  license: {
    label: "License & key",
    plural: "Licenses & keys",
    icon: FileKey2,
    color: "pink",
    fields: [
      { key: "product", label: "Product" },
      { key: "key", label: "Key", secret: true, multiline: true },
      { key: "email", label: "Registered to", type: "email" },
    ],
  },
  note: {
    label: "Secure note",
    plural: "Secure notes",
    icon: NotebookTabs,
    color: "slate",
    fields: [],
  },
};

export type VaultItem = {
  id: string;
  kind: Kind;
  name: string;
  fields: Record<string, string>;
  notes?: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};

/* ---------- Cards ---------- */

export function cardBrand(number = "") {
  const n = number.replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6(011|5)/.test(n)) return "Discover";
  return "Card";
}

/** Luhn checksum — catches typos in card numbers. */
export function luhnValid(number: string) {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function groupCardNumber(number = "") {
  const n = number.replace(/\D/g, "");
  return (n.match(/.{1,4}/g) ?? []).join(" ");
}

export function last4(number = "") {
  return number.replace(/\D/g, "").slice(-4);
}

/** When a card or document stops being valid, as a Date (end of the month for MM/YY). */
export function expiryOf(item: VaultItem): Date | null {
  if (item.kind === "card") {
    const m = item.fields.expiry?.match(/^\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*$/);
    if (!m) return null;
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return new Date(year, Number(m[1]), 0, 23, 59);
  }
  if (item.kind === "identity" && item.fields.expires) return new Date(`${item.fields.expires}T23:59`);
  return null;
}
