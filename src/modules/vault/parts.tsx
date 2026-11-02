import { useState } from "react";
import { Check, Copy, Eye, EyeOff, ExternalLink } from "lucide-react";
import { cn, swatch } from "@/lib/utils";
import { strength, STRENGTH } from "./crypto";
import { cardBrand, expiryOf, groupCardNumber, KINDS, last4, type Kind, type VaultItem } from "./kinds";

/* ---------- Clipboard ---------- */

let clearTimer: number | undefined;

/** Copies a value and wipes the clipboard 30 seconds later. */
export async function copySecret(value: string) {
  await navigator.clipboard.writeText(value);
  clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000);
}

/* ---------- Bits ---------- */

export function KindIcon({ kind, size = "md" }: { kind: Kind; size?: "sm" | "md" | "lg" }) {
  const def = KINDS[kind];
  const s = swatch(def.color);
  const Icon = def.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "sm" && "size-8 rounded-xl",
        size === "md" && "size-10 rounded-2xl",
        size === "lg" && "size-14 rounded-[20px]",
      )}
      style={{ background: s.soft, color: s.fg }}
    >
      <Icon className={size === "lg" ? "size-6" : size === "md" ? "size-[18px]" : "size-4"} />
    </span>
  );
}

export function StrengthBar({ password }: { password: string }) {
  const score = strength(password);
  const meta = STRENGTH[score];
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: password && i < Math.max(score, 1) ? meta.color : "var(--sunken)" }} />
        ))}
      </div>
      {password && <span className="w-16 text-right text-[12px] font-medium" style={{ color: meta.color }}>{meta.label}</span>}
    </div>
  );
}

/** One field of an item: label, value (masked when secret), reveal and copy. */
export function FieldRow({ label, value, secret, url, mono }: { label: string; value: string; secret?: boolean; url?: boolean; mono?: boolean }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const masked = secret && !shown;
  return (
    <div className="group flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-muted">{label}</div>
        <div className={cn("mt-0.5 whitespace-pre-wrap break-all text-[15px]", (mono || secret) && "font-mono text-[14px] tracking-wide", masked && "tracking-[0.2em] text-muted")}>
          {masked ? "•".repeat(Math.min(value.length, 14)) : value}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 pt-2.5">
        {secret && (
          <button onClick={() => setShown(!shown)} aria-label={shown ? "Hide" : "Reveal"} title={shown ? "Hide" : "Reveal"} className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink">
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
        {url && /^https?:\/\//i.test(value) && (
          <a href={value} target="_blank" rel="noopener noreferrer" aria-label="Open website" title="Open website" className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink">
            <ExternalLink className="size-4" />
          </a>
        )}
        <button
          onClick={async () => {
            await copySecret(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          aria-label="Copy"
          title={secret ? "Copy (clears in 30s)" : "Copy"}
          className="rounded-lg p-1.5 text-faint hover:bg-sunken hover:text-ink"
        >
          {copied ? <Check className="size-4 text-pos" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/* ---------- The card, drawn as a card ---------- */

const BRAND_BG: Record<string, string> = {
  Visa: "linear-gradient(135deg, #1a237e 0%, #3949ab 55%, #7c6cff 100%)",
  Mastercard: "linear-gradient(135deg, #2b1a1a 0%, #8c2f39 50%, #ec7a3c 100%)",
  Amex: "linear-gradient(135deg, #0f4c5c 0%, #1f9e85 60%, #8fd3c1 100%)",
  Discover: "linear-gradient(135deg, #3d2c12 0%, #b7791f 60%, #f0c46a 100%)",
  Card: "linear-gradient(135deg, #1d2130 0%, #394057 55%, #6b7493 100%)",
};

export function CardVisual({ item, reveal = false, small = false }: { item: VaultItem; reveal?: boolean; small?: boolean }) {
  const brand = cardBrand(item.fields.number);
  const exp = expiryOf(item);
  const expired = exp && exp < new Date();
  return (
    <div
      className={cn("relative flex aspect-[1.586] w-full flex-col justify-between overflow-hidden text-white shadow-card", small ? "rounded-2xl p-4" : "rounded-[22px] p-6")}
      style={{ background: BRAND_BG[brand] }}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 size-56 rounded-full bg-black/20 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <span className={cn("font-medium text-white/85", small ? "text-[12px]" : "text-[14px]")}>{item.name}</span>
        <span className={cn("font-serif italic", small ? "text-lg" : "text-2xl")}>{brand === "Card" ? "" : brand}</span>
      </div>
      {/* Chip */}
      <div className={cn("relative rounded-md bg-gradient-to-br from-[#f3d9a4] to-[#c9a35e] opacity-90", small ? "h-6 w-8" : "h-8 w-11")} />
      <div className="relative">
        <div className={cn("font-mono tracking-[0.14em]", small ? "text-[14px]" : "text-[20px]")}>
          {reveal ? groupCardNumber(item.fields.number) : `•••• •••• •••• ${last4(item.fields.number) || "••••"}`}
        </div>
        <div className={cn("mt-2 flex items-end justify-between uppercase text-white/80", small ? "text-[10px]" : "text-[12px]")}>
          <span className="truncate tracking-wider">{item.fields.holder}</span>
          {item.fields.expiry && <span className={cn("tabular tracking-wider", expired && "rounded bg-white/90 px-1.5 text-[#e0555a]")}>{expired ? "Expired " : ""}{item.fields.expiry}</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Security check ---------- */

export function audit(items: VaultItem[]) {
  const secrets = items.filter((i) => i.fields.password);
  const weak = secrets.filter((i) => strength(i.fields.password) <= 1);
  const counts = new Map<string, number>();
  for (const i of secrets) counts.set(i.fields.password, (counts.get(i.fields.password) ?? 0) + 1);
  const reused = secrets.filter((i) => (counts.get(i.fields.password) ?? 0) > 1);
  const soon = Date.now() + 60 * 86_400_000;
  const expiring = items.filter((i) => {
    const d = expiryOf(i);
    return d && d.getTime() < soon;
  });
  return { weak, reused, expiring };
}
