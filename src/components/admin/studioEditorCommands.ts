// Text transforms for the Studio markdown editor.
//
// Every edit is applied through `document.execCommand('insertText')` so the
// browser's native undo/redo stack stays intact and the textarea fires its
// normal `input` event (which keeps React state in sync). When execCommand is
// unavailable we fall back to mutating `value` directly and calling `commit`.
//
// The notes are stored and rendered as Markdown, but the site renders them with
// `marked`, which passes raw HTML through. That lets the toolbar express things
// Markdown can't — image width/position, captions, block alignment — as inline
// HTML that renders the same in the Studio preview and on the published page.

export interface EditorCommands {
  bold(): void;
  italic(): void;
  strike(): void;
  inlineCode(): void;
  heading(level: 1 | 2 | 3): void;
  bulletList(): void;
  orderedList(): void;
  taskList(): void;
  quote(): void;
  codeBlock(): void;
  divider(): void;
  table(): void;
  link(): void;
  align(direction: 'left' | 'center' | 'right'): void;
  /** Insert already-built markup (e.g. from the image dialog) as its own block. */
  insertBlock(markup: string): void;
  /** Raw insert at the caret, preserving undo. Used by paste/drop image upload. */
  insertInline(snippet: string): void;
  /**
   * Replace [from, to) with `text` (undo-safe), leaving the caret at `caret`
   * (defaults to just after the inserted text). Used by wikilink autocomplete
   * to swap the typed `[[query` token for a full link.
   */
  replaceRange(from: number, to: number, text: string, caret?: number): void;
}

type Commit = (value: string) => void;

interface Region {
  value: string;
  start: number;
  end: number;
  selected: string;
}

function read(el: HTMLTextAreaElement): Region {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  return { value: el.value, start, end, selected: el.value.slice(start, end) };
}

/**
 * Replace [rangeStart, rangeEnd) with `replacement`, then place the selection.
 * Uses execCommand so the change is undoable and the input event fires.
 */
function replaceRange(
  el: HTMLTextAreaElement,
  commit: Commit,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
  selectStart: number,
  selectEnd: number,
): void {
  el.focus();
  el.setSelectionRange(rangeStart, rangeEnd);
  // execCommand is the only broadly supported insertion path that participates
  // in a textarea's native undo stack. Access it reflectively so this legacy
  // compatibility branch is isolated; setRangeText remains the fallback.
  const execCommand = Reflect.get(document, 'execCommand') as
    ((command: string, showUi: boolean, value: string) => boolean) | undefined;
  const ok = execCommand?.call(document, 'insertText', false, replacement);
  if (!ok) {
    el.setRangeText(replacement, rangeStart, rangeEnd, 'end');
    commit(el.value);
  }
  // Defer so it lands after the browser processes the insertion.
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(selectStart, selectEnd);
  });
}

// --- Inline wrapping (bold / italic / strike / code) ----------------------

function toggleWrap(
  el: HTMLTextAreaElement,
  commit: Commit,
  marker: string,
): void {
  const { value, start, end, selected } = read(el);
  const len = marker.length;
  const before = value.slice(0, start);
  const after = value.slice(end);

  // Selection already includes the markers on both ends → unwrap inward.
  if (
    selected.length >= 2 * len &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    replaceRange(el, commit, start, end, inner, start, start + inner.length);
    return;
  }

  // Markers sit just outside the selection → unwrap outward.
  if (before.endsWith(marker) && after.startsWith(marker)) {
    replaceRange(
      el,
      commit,
      start - len,
      end + len,
      selected,
      start - len,
      start - len + selected.length,
    );
    return;
  }

  // Otherwise wrap. Keep the original text selected (or drop the caret between
  // the markers when there was no selection).
  const wrapped = `${marker}${selected}${marker}`;
  if (start === end) {
    replaceRange(el, commit, start, end, wrapped, start + len, start + len);
  } else {
    replaceRange(el, commit, start, end, wrapped, start + len, end + len);
  }
}

// --- Line-based prefixes (headings / lists / quote) -----------------------

function lineBounds(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  // A caret sitting at the very start of a line shouldn't pull in the line above.
  if (end > start && value[end - 1] === '\n') lineEnd = end - 1;
  return { lineStart, lineEnd };
}

const LEADING_MARKERS =
  /^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)?/;

function stripMarker(line: string): { indent: string; text: string } {
  const match = LEADING_MARKERS.exec(line);
  const indent = match?.[1] ?? '';
  return { indent, text: line.slice(match?.[0]?.length ?? 0) };
}

function transformLines(
  el: HTMLTextAreaElement,
  commit: Commit,
  transform: (lines: string[]) => string[],
): void {
  const { value, start, end } = read(el);
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const next = transform(block.split('\n')).join('\n');
  replaceRange(
    el,
    commit,
    lineStart,
    lineEnd,
    next,
    lineStart,
    lineStart + next.length,
  );
}

function heading(el: HTMLTextAreaElement, commit: Commit, level: 1 | 2 | 3) {
  const hashes = '#'.repeat(level);
  const already = new RegExp(`^#{${level}}\\s+`);
  transformLines(el, commit, (lines) => {
    const allSet = lines.every((l) => l.trim() === '' || already.test(l));
    return lines.map((line) => {
      if (line.trim() === '') return line;
      const { indent, text } = stripMarker(line);
      return allSet ? indent + text : `${indent}${hashes} ${text}`;
    });
  });
}

function toggleList(
  el: HTMLTextAreaElement,
  commit: Commit,
  kind: 'bullet' | 'ordered' | 'task',
) {
  const test =
    kind === 'bullet'
      ? /^\s*[-*+]\s+(?!\[[ xX]\])/
      : kind === 'ordered'
        ? /^\s*\d+\.\s+/
        : /^\s*[-*+]\s+\[[ xX]\]\s+/;
  transformLines(el, commit, (lines) => {
    const meaningful = lines.filter((l) => l.trim() !== '');
    const allSet =
      meaningful.length > 0 && meaningful.every((l) => test.test(l));
    let n = 0;
    return lines.map((line) => {
      if (line.trim() === '') return line;
      const { indent, text } = stripMarker(line);
      if (allSet) return indent + text;
      n += 1;
      const marker =
        kind === 'bullet' ? '- ' : kind === 'ordered' ? `${n}. ` : '- [ ] ';
      return `${indent}${marker}${text}`;
    });
  });
}

function toggleQuote(el: HTMLTextAreaElement, commit: Commit) {
  const test = /^\s*>\s?/;
  transformLines(el, commit, (lines) => {
    const meaningful = lines.filter((l) => l.trim() !== '');
    const allSet =
      meaningful.length > 0 && meaningful.every((l) => test.test(l));
    return lines.map((line) => {
      if (allSet) return line.replace(test, '');
      return line.trim() === '' ? line : `> ${line}`;
    });
  });
}

// --- Block insertion (code fence / table / rule / alignment / image) ------

function insertBlock(el: HTMLTextAreaElement, commit: Commit, block: string) {
  const { value, start, end } = read(el);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leadGap =
    before === '' || before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n')
        ? '\n'
        : '\n\n';
  const trailGap =
    after === '' || after.startsWith('\n\n')
      ? ''
      : after.startsWith('\n')
        ? '\n'
        : '\n\n';
  const payload = `${leadGap}${block}${trailGap}`;
  const caret = start + leadGap.length + block.length;
  replaceRange(el, commit, start, end, payload, caret, caret);
}

function codeBlock(el: HTMLTextAreaElement, commit: Commit) {
  const { selected } = read(el);
  insertBlock(el, commit, '```\n' + (selected || '') + '\n```');
}

function table(el: HTMLTextAreaElement, commit: Commit) {
  insertBlock(
    el,
    commit,
    [
      '| Column | Column |',
      '| --- | --- |',
      '| Cell | Cell |',
      '| Cell | Cell |',
    ].join('\n'),
  );
}

function align(
  el: HTMLTextAreaElement,
  commit: Commit,
  direction: 'left' | 'center' | 'right',
) {
  const { value, start, end } = read(el);
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const inner = value.slice(lineStart, lineEnd) || 'Aligned text';
  // Blank lines inside the div let marked parse the inner content as Markdown
  // while the wrapping div still applies the alignment.
  const wrapped = `<div style="text-align:${direction}">\n\n${inner}\n\n</div>`;
  const caretBase = lineStart;
  const before = value.slice(0, lineStart);
  const leadGap =
    before === '' || before.endsWith('\n\n')
      ? ''
      : before.endsWith('\n')
        ? '\n'
        : '\n\n';
  const after = value.slice(lineEnd);
  const trailGap =
    after === '' || after.startsWith('\n\n')
      ? ''
      : after.startsWith('\n')
        ? '\n'
        : '\n\n';
  const payload = `${leadGap}${wrapped}${trailGap}`;
  // Select the inner text so it can be retyped immediately.
  const innerStart =
    caretBase +
    leadGap.length +
    `<div style="text-align:${direction}">\n\n`.length;
  replaceRange(
    el,
    commit,
    lineStart,
    lineEnd,
    payload,
    innerStart,
    innerStart + inner.length,
  );
}

function link(el: HTMLTextAreaElement, commit: Commit) {
  const { start, end, selected } = read(el);
  const text = selected || 'link text';
  const url = 'https://';
  const markup = `[${text}](${url})`;
  // Drop the caret onto the URL so it's ready to overwrite.
  const urlStart = start + `[${text}](`.length;
  replaceRange(el, commit, start, end, markup, urlStart, urlStart + url.length);
}

function insertInline(
  el: HTMLTextAreaElement,
  commit: Commit,
  snippet: string,
) {
  const { start, end } = read(el);
  const caret = start + snippet.length;
  replaceRange(el, commit, start, end, snippet, caret, caret);
}

export function makeEditorCommands(
  getEl: () => HTMLTextAreaElement | null,
  commit: Commit,
): EditorCommands {
  const run = (fn: (el: HTMLTextAreaElement) => void) => {
    const el = getEl();
    if (el) fn(el);
  };
  return {
    bold: () => run((el) => toggleWrap(el, commit, '**')),
    italic: () => run((el) => toggleWrap(el, commit, '_')),
    strike: () => run((el) => toggleWrap(el, commit, '~~')),
    inlineCode: () => run((el) => toggleWrap(el, commit, '`')),
    heading: (level) => run((el) => heading(el, commit, level)),
    bulletList: () => run((el) => toggleList(el, commit, 'bullet')),
    orderedList: () => run((el) => toggleList(el, commit, 'ordered')),
    taskList: () => run((el) => toggleList(el, commit, 'task')),
    quote: () => run((el) => toggleQuote(el, commit)),
    codeBlock: () => run((el) => codeBlock(el, commit)),
    divider: () => run((el) => insertBlock(el, commit, '---')),
    table: () => run((el) => table(el, commit)),
    link: () => run((el) => link(el, commit)),
    align: (direction) => run((el) => align(el, commit, direction)),
    insertBlock: (markup) => run((el) => insertBlock(el, commit, markup)),
    insertInline: (snippet) => run((el) => insertInline(el, commit, snippet)),
    replaceRange: (from, to, text, caret) =>
      run((el) => {
        const pos = caret ?? from + text.length;
        replaceRange(el, commit, from, to, text, pos, pos);
      }),
  };
}

// --- Image markup builder (shared by dialog + quick insert) ---------------

export type ImageAlign = 'inline' | 'left' | 'center' | 'right';

export interface ImageMarkupOptions {
  src: string;
  alt: string;
  caption?: string;
  /** Width as a percentage 10–100, or undefined for natural width. */
  widthPercent?: number;
  align: ImageAlign;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the markup for an image. When it needs no styling or caption we emit a
 * plain Markdown image so the source stays clean; anything richer becomes inline
 * HTML (which `marked` renders verbatim in both the preview and the live page).
 */
export function buildImageMarkup(options: ImageMarkupOptions): string {
  const { src, alt, caption, widthPercent, align } = options;
  const trimmedCaption = caption?.trim();
  const hasWidth = typeof widthPercent === 'number' && widthPercent < 100;

  if (align === 'inline' && !hasWidth && !trimmedCaption) {
    return `![${alt}](${src})`;
  }

  const styles: string[] = [];
  if (hasWidth) styles.push(`width:${widthPercent}%`);
  if (align === 'center') {
    styles.push('display:block', 'margin-left:auto', 'margin-right:auto');
  } else if (align === 'left') {
    styles.push('float:left', 'margin:0.4em 1.2em 0.8em 0');
  } else if (align === 'right') {
    styles.push('float:right', 'margin:0.4em 0 0.8em 1.2em');
  }
  const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';
  const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${styleAttr}>`;

  if (!trimmedCaption) return img;

  const figureAlign =
    align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  return [
    `<figure style="margin:1.2em 0;text-align:${figureAlign}">`,
    `  ${img}`,
    `  <figcaption style="margin-top:0.5em;font-size:0.85em;opacity:0.7">${escapeAttr(
      trimmedCaption,
    )}</figcaption>`,
    `</figure>`,
  ].join('\n');
}
