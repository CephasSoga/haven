import { useState } from "react";
import { BookOpen, Check, GraduationCap, Headphones, Mic2, Newspaper, PlayCircle, Bookmark, BookmarkCheck, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { KINDS, SOURCES, type Found, type Kind } from "./sources";
import { useLearning, type Resource } from "./store";

export const ACCENT = "#2f7d6d";

const KIND_ICONS: Record<Kind, typeof BookOpen> = { course: GraduationCap, video: PlayCircle, talk: Mic2, book: BookOpen, podcast: Headphones, article: Newspaper };

export function SourceBadge({ source }: { source: Found["source"] }) {
  const s = SOURCES[source];
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: s.color }}>
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.short}
    </span>
  );
}

/** A picture when there is one, otherwise the kind of thing in the source's colour. */
export function Thumb({ item, className }: { item: Pick<Found, "image" | "kind" | "source">; className?: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICONS[item.kind];
  const color = SOURCES[item.source].color;
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl", className)} style={{ background: `${color}1a`, color }}>
      {item.image && !broken ? (
        <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon className="size-5" />
      )}
    </div>
  );
}

export const minutesText = (m?: number) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);

export function Meta({ item }: { item: Pick<Found, "kind" | "source" | "by" | "minutes"> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
      <SourceBadge source={item.source} />
      <span>{KINDS[item.kind].label}</span>
      {item.minutes ? <span>{minutesText(item.minutes)}</span> : null}
      {item.by && <span className="truncate">{item.by}</span>}
    </div>
  );
}

/** What can be done with something found: add it to this goal, or save it / add it to any goal. */
export function AddActions({ found, goalId }: { found: Found; goalId?: string }) {
  const resources = useLearning((s) => s.resources);
  const goals = useLearning((s) => s.goals).filter((g) => g.status !== "done");
  const add = useLearning((s) => s.add);
  const inGoal = (id?: string) => resources.some((r) => r.ref === found.id && r.goalId === id);

  if (goalId) {
    const added = inGoal(goalId);
    return (
      <button
        onClick={() => !added && add(found, goalId)}
        className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors", added ? "text-pos" : "bg-sunken hover:bg-line")}
      >
        {added ? <Check className="size-4" /> : <Plus className="size-4" />}
        {added ? "In the plan" : "Add to plan"}
      </button>
    );
  }
  const saved = inGoal(undefined);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={() => !saved && add(found)}
        title={saved ? "Saved" : "Save for later"}
        aria-label={saved ? "Saved" : "Save for later"}
        className={cn("flex size-8 items-center justify-center rounded-lg transition-colors", saved ? "text-pos" : "text-muted hover:bg-sunken hover:text-ink")}
      >
        {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      </button>
      {goals.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && add(found, e.target.value)}
          aria-label="Add to a goal"
          className="h-8 max-w-36 cursor-pointer rounded-lg border border-line bg-surface px-2 text-[12px] text-muted hover:text-ink"
        >
          <option value="">Add to goal…</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id} disabled={inGoal(g.id)}>
              {inGoal(g.id) ? "✓ " : ""}
              {g.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ResultRow({ found, goalId }: { found: Found; goalId?: string }) {
  return (
    <li className="flex gap-3 rounded-2xl px-3 py-3 hover:bg-sunken/60">
      <Thumb item={found} className="size-14" />
      <div className="min-w-0 flex-1">
        <a href={found.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[14px] font-medium leading-snug hover:underline">
          {found.title}
        </a>
        <Meta item={found} />
        {found.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{found.description}</p>}
      </div>
      <AddActions found={found} goalId={goalId} />
    </li>
  );
}

export const asFound = (r: Resource): Found => ({ id: r.ref, source: r.source, kind: r.kind, title: r.title, url: r.url, by: r.by, description: r.description, image: r.image, minutes: r.minutes });
