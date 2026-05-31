export interface DocParagraph {
  /** Stable, short id for this paragraph in this run (e.g. "p1", "p2", ...). */
  id: string;
  /** The paragraph's literal text, sliced from the source document at `offset`. */
  text: string;
  /** Start offset within the source document. */
  offset: number;
}

/**
 * Splits a document into one paragraph per line break.
 *
 * Treats every `\r?\n` as a paragraph boundary — matches the granularity Google
 * Docs uses when it serialises the document via the txt export (one line per
 * Docs paragraph). Whitespace-only segments are dropped so empty lines don't
 * become empty tasks.
 *
 * Each emitted paragraph carries its `offset` in the original `text`, so issue
 * offsets returned by the parser stay aligned with the full document.
 */
export function splitIntoParagraphs(text: string): DocParagraph[] {
  const paragraphs: DocParagraph[] = [];
  const splitPattern = /\r?\n/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let counter = 0;

  const push = (start: number, end: number): void => {
    const slice = text.slice(start, end);
    if (slice.trim().length === 0) return;
    counter += 1;
    paragraphs.push({ id: `p${counter}`, text: slice, offset: start });
  };

  while ((match = splitPattern.exec(text)) !== null) {
    push(lastIndex, match.index);
    lastIndex = splitPattern.lastIndex;
  }
  push(lastIndex, text.length);

  return paragraphs;
}
