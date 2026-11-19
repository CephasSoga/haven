import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Headphones, Loader2 } from "lucide-react";
import { Button, Field, Modal, Select } from "@/components/ui";
import { describeBook, prepareAudiobook, useAudiobooks } from "./audiobook";
import { LANGS, NATURAL, naturalVoiceFor, useVoicePrefs, type Lang } from "./voices";
import type { Book } from "./store";

/** Making a book into an audiobook: pick the voice, see how long it is, start. */
export function AudiobookDialog({ book, onClose }: { book: Book | null; onClose: () => void }) {
  const navigate = useNavigate();
  const existing = useAudiobooks((s) => (book ? s.books[book.id] : undefined));
  const [info, setInfo] = useState<{ chapters: number; hours: number; lang: Lang } | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [voice, setVoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!book) return;
    setInfo(null);
    setError(null);
    if (existing) return;
    let alive = true;
    describeBook(book)
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        setLang(d.lang);
        setVoice(naturalVoiceFor(d.lang)?.id ?? "");
        if (!d.chapters) setError("There's no text to read in this book. (A scanned PDF has only pictures of text.)");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const voices = NATURAL.filter((v) => v.lang === lang);
  const open = () => {
    onClose();
    navigate(`/audiobooks?mine=${book!.id}`);
  };
  const start = async () => {
    if (!book || !voice) return;
    setBusy(true);
    try {
      useVoicePrefs.getState().set({ natural: { ...useVoicePrefs.getState().natural, [lang]: voice } });
      await prepareAudiobook(book, voice, lang);
      open();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hours = info?.hours ?? 0;
  const fmt = (h: number) => {
    const minutes = h * 60;
    if (minutes < 5) return "a few minutes";
    if (h < 1) return `${Math.round(minutes / 5) * 5} minutes`;
    return `${Math.round(h * 10) / 10} hours`;
  };

  return (
    <Modal
      open={!!book}
      onClose={onClose}
      title={existing ? "Audiobook" : "Make an audiobook"}
      footer={
        existing ? (
          <Button variant="primary" onClick={open}>
            <Headphones className="size-4" /> Open in Audiobooks
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void start()} disabled={!info?.chapters || !voice || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Headphones className="size-4" />} Start
            </Button>
          </>
        )
      }
    >
      {existing ? (
        <p className="text-[14px] text-muted">
          {book?.title} is already being made into audio ({existing.chapters.filter((c) => c.state === "ready").length} of {existing.chapters.length} chapters ready). Listen to it in Audiobooks.
        </p>
      ) : !info && !error ? (
        <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
          <Loader2 className="size-4 animate-spin" /> Looking through the book…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {info && info.chapters > 0 && (
            <>
              <p className="text-[14px] leading-relaxed text-muted">
                {info.chapters} chapter{info.chapters === 1 ? "" : "s"}, about {fmt(hours)} of listening. A natural voice on this device reads it, chapter by chapter, in the
                background — on an ordinary computer that takes a bit longer than listening (here, roughly {fmt(hours * 1.6)}). Chapters appear in Audiobooks as they're ready, and it picks up
                where it stopped if you close Haven.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Language">
                  {(id) => (
                    <Select
                      id={id}
                      value={lang}
                      onChange={(e) => {
                        const l = e.target.value as Lang;
                        setLang(l);
                        setVoice(naturalVoiceFor(l)?.id ?? "");
                      }}
                    >
                      {(Object.keys(LANGS) as Lang[]).map((l) => (
                        <option key={l} value={l}>
                          {LANGS[l]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Voice">
                  {(id) => (
                    <Select id={id} value={voice} onChange={(e) => setVoice(e.target.value)}>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <p className="text-[12px] text-faint">The voice is downloaded once (about 65 MB). The audio stays on this device, about 15 MB per hour.</p>
            </>
          )}
          {error && <p className="text-[14px] text-neg">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
