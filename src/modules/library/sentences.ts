/**
 * Turns the text on a page (a PDF page's text layer, or an EPUB chapter) into sentences to read
 * aloud, each with the stretch of the page it covers, so it can be highlighted as it's read.
 */

export type Sentence = { text: string; range: Range };

const BLOCK = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|SECTION|ARTICLE|TD|TH|DT|DD|FIGCAPTION|PRE|ASIDE|HEADER|FOOTER|TR)$/;
const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|RT|SUP)$/;
/** Pieces longer than this are split at commas and the like, so each comes back from the voice quickly. */
const MAX = 260;

const blockOf = (n: Node) => {
  let el = n.parentElement;
  while (el && !BLOCK.test(el.tagName)) el = el.parentElement;
  return el;
};

/** Words split across a line break ("conver-" + "sation") are joined back for speaking. */
export const speakable = (s: string) =>
  s
    .replace(/(\p{Ll})-\s+(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The sentences under `root`, starting at `from` (a point in the text) when given.
 * `skip` leaves out text in elements it returns true for (a PDF page's running header, say).
 */
export function sentencesIn(root: Node, lang: string, opts: { from?: { node: Node; offset: number }; skip?: (el: Element) => boolean } = {}): Sentence[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let el = n.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIP.test(el.tagName) || opts.skip?.(el)) return NodeFilter.FILTER_REJECT;
      }
      return n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  // All the text in one string, remembering which node each stretch came from.
  let text = "";
  const pieces: { node: Text; start: number; skip: number }[] = [];
  let lastBlock: Element | null = null;
  let started = !opts.from;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    let skip = 0;
    if (!started) {
      // Begin at the given point: skip nodes before it, and the part of its own node before the offset.
      if (n === opts.from!.node) {
        started = true;
        skip = opts.from!.offset;
      } else if (opts.from!.node.contains(n) || (opts.from!.node.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) started = true;
      else continue;
    }
    const block = blockOf(n);
    // A new paragraph or heading is a hard break; a new line inside one (a PDF's text) is a space.
    const afterBreak = n.previousSibling?.nodeName === "BR" || n.parentElement?.previousSibling?.nodeName === "BR";
    if (text) text += block !== lastBlock ? "\n" : afterBreak && /\S$/.test(text) ? " " : "";
    lastBlock = block;
    pieces.push({ node: n, start: text.length, skip });
    text += n.data.slice(skip);
  }
  if (!text.trim()) return [];

  // Where a position in the string is on the page.
  const at = (pos: number, end = false) => {
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pieces[mid].start <= pos - (end ? 1 : 0)) lo = mid;
      else hi = mid - 1;
    }
    const p = pieces[lo];
    return { node: p.node, offset: Math.min(p.node.length, p.skip + Math.max(0, pos - p.start)) };
  };
  const rangeOf = (from: number, to: number) => {
    const r = doc.createRange();
    const a = at(from);
    const b = at(to, true);
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  };

  const out: Sentence[] = [];
  const add = (from: number, to: number) => {
    // Trim the ends so the highlight hugs the words.
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    const s = speakable(text.slice(from, to));
    if (s && /[\p{L}\p{N}]/u.test(s)) out.push({ text: s, range: rangeOf(from, to) });
  };
  const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  for (const seg of segmenter.segment(text)) {
    // Paragraph breaks always end a sentence (headings have no full stop).
    let start = seg.index;
    for (const part of seg.segment.split("\n")) {
      const end = start + part.length;
      if (end - start <= MAX) add(start, end);
      else {
        // A long sentence goes in pieces at its commas, semicolons and dashes.
        let from = start;
        const marks = [...part.matchAll(/[,;:—–]\s/g)].map((m) => start + m.index! + 1);
        for (const m of marks) if (m - from >= MAX * 0.5) (add(from, m), (from = m));
        add(from, end);
      }
      start = end + 1;
    }
  }
  return out;
}

/** Plain text (a chapter's) as sentences to speak; paragraphs are separated by blank lines or line breaks. */
export function textSentences(text: string, lang: string): string[] {
  const out: string[] = [];
  const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  for (const paragraph of text.split(/\n+/)) {
    for (const seg of segmenter.segment(paragraph)) {
      const s = speakable(seg.segment);
      if (!s || !/[\p{L}\p{N}]/u.test(s)) continue;
      if (s.length <= MAX) {
        out.push(s);
        continue;
      }
      // A long sentence goes in pieces at its commas, semicolons and dashes.
      let rest = s;
      while (rest.length > MAX) {
        const cut = Math.max(rest.lastIndexOf(", ", MAX), rest.lastIndexOf("; ", MAX), rest.lastIndexOf(": ", MAX), rest.lastIndexOf(" — ", MAX));
        const at = cut > MAX * 0.4 ? cut + 1 : rest.lastIndexOf(" ", MAX) > 0 ? rest.lastIndexOf(" ", MAX) : MAX;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) out.push(rest);
    }
    // A paragraph ends with a slightly longer pause.
    if (out.length && out[out.length - 1] !== "\n") out.push("\n");
  }
  return out;
}
