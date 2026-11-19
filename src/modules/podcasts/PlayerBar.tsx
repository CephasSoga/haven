import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Pause, Play, RotateCcw, RotateCw, StickyNote, X } from "lucide-react";
import { Button, Modal, Textarea } from "@/components/ui";
import { groupFor, useNotes } from "@/modules/notes/store";
import { close, currentTime, play, seekBy, seekTo, setSpeed, SPEEDS, toggle, usePlayer } from "./player";
import { clock, usePodcasts } from "./store";

/**
 * The player at the bottom of every screen while an episode is loaded: play/pause, back 15 s,
 * forward 30 s, speed, a note at this moment (saved in Notes, in the show's group), and close.
 */
export function PlayerBar() {
  const { episode, playing, loading, position, duration, error } = usePlayer();
  const show = usePodcasts((s) => s.shows.find((x) => x.id === episode?.showId));
  const speed = usePodcasts((s) => s.speed);
  const navigate = useNavigate();
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const shown = !!episode;

  // Leave room at the bottom of every page so the bar never covers the end of it.
  useEffect(() => {
    document.documentElement.style.setProperty("--player-space", shown ? "5.5rem" : "0px");
    return () => document.documentElement.style.setProperty("--player-space", "0px");
  }, [shown]);

  const total = duration || episode?.duration || 0;
  const art = episode?.artwork || show?.artwork;
  const nextSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1);

  return (
    <>
      <AnimatePresence>
        {episode && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[45] overflow-hidden rounded-2xl border border-line bg-raised/95 shadow-float backdrop-blur-xl md:bottom-4 md:left-64 md:right-6"
          >
            {/* Progress, clickable to jump */}
            <div
              className="group relative h-1.5 cursor-pointer bg-sunken"
              onClick={(e) => {
                if (!total) return;
                const box = e.currentTarget.getBoundingClientRect();
                seekTo(((e.clientX - box.left) / box.width) * total);
              }}
              title={total ? `${clock(position)} of ${clock(total)}` : undefined}
            >
              <div className="h-full bg-[#9b5de5]" style={{ width: total ? `${Math.min(100, (position / total) * 100)}%` : "0%" }} />
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3">
              <button
                onClick={() => navigate(`/podcasts?show=${episode.showId}`)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title="Open the show"
              >
                {art ? <img src={art} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <div className="size-10 shrink-0 rounded-lg bg-sunken" />}
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium">{episode.title}</div>
                  <div className="truncate text-[12px] text-muted">
                    {error ? <span className="text-neg">{error}</span> : <>{show?.title ?? ""} · <span className="tabular">{clock(position)}{total ? ` / ${clock(total)}` : ""}</span></>}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                <IconBtn label="Back 15 seconds" onClick={() => seekBy(-15)} className="max-sm:hidden">
                  <RotateCcw className="size-[18px]" />
                </IconBtn>
                <button
                  onClick={() => (episode && !playing ? void play(episode) : toggle())}
                  aria-label={playing ? "Pause" : "Play"}
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-soft transition-transform active:scale-95"
                >
                  {loading && playing ? <Loader2 className="size-4 animate-spin" /> : playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
                </button>
                <IconBtn label="Forward 30 seconds" onClick={() => seekBy(30)}>
                  <RotateCw className="size-[18px]" />
                </IconBtn>
                <button onClick={nextSpeed} title="Playback speed" className="min-w-11 rounded-lg px-1.5 py-1 text-[12px] font-semibold tabular text-muted hover:bg-sunken hover:text-ink">
                  {speed}×
                </button>
                <IconBtn label="Note at this moment (goes into Notes)" onClick={() => setNoteAt(currentTime())} className="max-sm:hidden">
                  <StickyNote className="size-[18px]" />
                </IconBtn>
                <IconBtn label="Close the player" onClick={close}>
                  <X className="size-[18px]" />
                </IconBtn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <MomentNote at={noteAt} onClose={() => setNoteAt(null)} />
    </>
  );
}

function IconBtn({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-sunken hover:text-ink ${className ?? ""}`}>
      {children}
    </button>
  );
}

/** A note about this moment of the episode, saved in Notes in a group named after the show. */
export function MomentNote({ at, onClose }: { at: number | null; onClose: () => void }) {
  const episode = usePlayer((s) => s.episode);
  const show = usePodcasts((s) => s.shows.find((x) => x.id === episode?.showId));
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (at !== null) (setText(""), setSaved(false));
  }, [at]);

  const save = () => {
    const note = text.trim();
    if (!note || !episode || at === null) return;
    const showName = show?.title ?? "Podcasts";
    const groupId = groupFor({ kind: "podcast", id: episode.showId }, showName);
    useNotes.getState().create({
      title: note.split("\n")[0].slice(0, 60),
      body: `${note}\n\n— ${episode.title} · ${showName}, at ${clock(at)}`,
      color: "violet",
      groupId,
    });
    setSaved(true);
    setTimeout(onClose, 700);
  };

  return (
    <Modal
      open={at !== null}
      onClose={onClose}
      title={`Note at ${clock(at ?? 0)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!text.trim() || saved}>
            {saved ? "Saved" : "Save to Notes"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="text-[12px] text-faint">
          {episode?.title} · {show?.title}
        </div>
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
          placeholder="An idea, a name, something to look up…"
          className="min-h-28"
        />
        <p className="text-[12px] text-faint">Saved in Notes, in a group named after the show.</p>
      </div>
    </Modal>
  );
}
