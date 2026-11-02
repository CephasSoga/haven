import { cn } from "@/lib/utils";
import type { Book } from "./store";

/** A typographic cover for books that don't come with one. */
export const SPINES = [
  ["#2a2c55", "#6a4c93"],
  ["#0f4c5c", "#1f9e85"],
  ["#5c2a2a", "#c0583f"],
  ["#3d2c12", "#b7791f"],
  ["#1d2130", "#4a5470"],
  ["#40214a", "#a5508a"],
];
export function spine(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPINES[h % SPINES.length];
}

export function Cover({ book, className }: { book: Book; className?: string }) {
  const [a, b] = spine(book.id);
  return (
    <div className={cn("relative aspect-[2/3] overflow-hidden rounded-r-xl rounded-l-[4px] shadow-card", className)}>
      {book.cover ? (
        <img src={book.cover} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-[12%] text-white" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}>
          <span className="font-serif text-[clamp(14px,1.6vw,22px)] leading-tight">{book.title}</span>
          {book.author && <span className="text-[clamp(9px,0.8vw,11px)] uppercase tracking-[0.12em] opacity-75">{book.author}</span>}
        </div>
      )}
      {/* Spine shading so it reads as a book */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/25 via-white/10 to-transparent" />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10" />
    </div>
  );
}

