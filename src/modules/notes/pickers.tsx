import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { COVERS } from "./store";

const EMOJI: Record<string, string[]> = {
  Popular: ["📝", "📌", "💡", "✨", "🎯", "📚", "🗓️", "✅", "🧠", "🚀", "❤️", "⭐"],
  Life: ["🏠", "🌱", "🍋", "🍝", "☕", "🧘", "🏃", "🛒", "🎁", "👨‍👩‍👧", "🐾", "🎉"],
  Work: ["💼", "📊", "📈", "🧾", "🛠️", "💻", "📎", "🗂️", "📣", "🤝", "🧪", "🔑"],
  Places: ["🏔️", "🏖️", "🌍", "✈️", "🚆", "🗺️", "🏕️", "🌇", "🏛️", "⛵", "🌋", "🗼"],
  Mood: ["🌙", "☀️", "🌈", "🔥", "🌊", "🍂", "❄️", "🌸", "🎨", "🎵", "📷", "🕯️"],
};
const ALL = Object.values(EMOJI).flat();

/** A small floating panel anchored to its trigger. Clicking outside closes it. */
export function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className={cn("absolute z-50 mt-2 rounded-2xl border border-line bg-raised p-3 shadow-float", className)}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function EmojiPicker({ onPick, onRemove }: { onPick: (e: string) => void; onRemove?: () => void }) {
  return (
    <div className="w-[300px]">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => onPick(ALL[Math.floor(Math.random() * ALL.length)])} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink">
          <Shuffle className="size-3.5" /> Random
        </button>
        {onRemove && (
          <button onClick={onRemove} className="rounded-lg px-2 py-1 text-[13px] font-medium text-muted hover:bg-sunken hover:text-neg">
            Remove
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto pr-1">
        {Object.entries(EMOJI).map(([group, list]) => (
          <div key={group} className="mb-2">
            <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{group}</div>
            <div className="grid grid-cols-6 gap-0.5">
              {list.map((e) => (
                <button key={e} onClick={() => onPick(e)} className="flex aspect-square items-center justify-center rounded-lg text-[22px] transition-transform hover:scale-110 hover:bg-sunken">
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CoverPicker({ value, onPick, onRemove }: { value?: string; onPick: (id: string) => void; onRemove: () => void }) {
  return (
    <div className="w-[280px]">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Covers</span>
        <button onClick={onRemove} className="rounded-lg px-2 py-1 text-[13px] font-medium text-muted hover:bg-sunken hover:text-neg">
          Remove
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(COVERS).map(([id, bg]) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            aria-label={id}
            className={cn("h-12 rounded-xl transition-transform hover:scale-105", value === id && "ring-2 ring-cal ring-offset-2 ring-offset-raised")}
            style={{ background: bg }}
          />
        ))}
      </div>
    </div>
  );
}
