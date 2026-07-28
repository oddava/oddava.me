// The block model behind the Studio visual editor.
//
// The Markdown string stays the single source of truth. Nothing here builds a
// document model that has to be serialized back: a block is a *slice* of the
// note, `[start, end)`, and every edit is a splice into that slice. Text the
// editor never touched comes out byte-identical — which is what keeps raw HTML
// blocks, alignment wrappers and figures from being quietly rewritten by a
// round trip through a rich-text model.
//
// Everything in this file is pure so the parsing, the caret mapping and the
// list behaviour can be tested without a DOM.

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'task'
  | 'quote'
  | 'code'
  | 'table'
  | 'divider'
  | 'html'
  | 'image';

export interface StudioBlock {
  type: BlockType;
  /** The block's Markdown, without the blank lines that separate it. */
  raw: string;
  /** Offset of the first character in the document. */
  start: number;
  /** Offset just past the last character. */
  end: number;
  /** Heading depth, for `heading` blocks only. */
  depth?: number;
}

/** A half-open document range the visual editor is currently editing. */
export interface BlockRange {
  start: number;
  end: number;
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+/;
const DIVIDER = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^(\s*)([-*+])(\s+)/;
const ORDERED = /^(\s*)(\d{1,9})([.)])(\s+)/;
const TASK = /^(\s*)([-*+])(\s+)\[([ xX])\]\s/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const IMAGE_ONLY = /^!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)$/;

// Block-level HTML containers whose content legitimately holds blank lines —
// the alignment wrapper the toolbar writes, and figures with captions. They end
// at their own closing tag, not at the first empty line.
const HTML_CONTAINER =
  /^ {0,3}<(div|figure|details|section|aside|table|ul|ol|blockquote|pre)\b/i;
const HTML_OPEN = /^ {0,3}<[a-zA-Z!/]/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function isListLine(line: string): boolean {
  return BULLET.test(line) || ORDERED.test(line);
}

/** Indentation width, counting a tab as two columns (the editor's tab-size). */
function indentWidth(line: string): number {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
  return [...leading].reduce((total, ch) => total + (ch === '\t' ? 2 : 1), 0);
}

function classifyList(lines: string[]): 'list' | 'task' {
  return lines.some((line) => TASK.test(line)) ? 'task' : 'list';
}

/**
 * Split a note into top-level blocks. Blocks cover every non-blank line; the
 * blank lines between them are separators and belong to no block, so a splice
 * into one block cannot disturb the spacing around it.
 */
export function parseBlocks(markdown: string): StudioBlock[] {
  const lines = markdown.split('\n');
  // Offset of the first character of each line.
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const blocks: StudioBlock[] = [];
  const push = (type: BlockType, from: number, to: number, depth?: number) => {
    const start = offsets[from]!;
    const end = offsets[to]! + lines[to]!.length;
    const raw = markdown.slice(start, end);
    blocks.push(
      depth ? { type, raw, start, end, depth } : { type, raw, start, end },
    );
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    // --- Fenced code: opaque, blank lines and all -------------------------
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2]![0]!;
      const width = fence[2]!.length;
      const closer = new RegExp(`^\\s*\\${marker}{${width},}\\s*$`);
      let last = index;
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        last = scan;
        if (closer.test(lines[scan]!)) break;
      }
      push('code', index, last);
      index = last + 1;
      continue;
    }

    // --- Raw HTML ---------------------------------------------------------
    if (HTML_OPEN.test(line)) {
      const container = HTML_CONTAINER.exec(line);
      let last = index;
      let closed = false;
      if (container) {
        const closer = new RegExp(`</${container[1]}\\s*>\\s*$`, 'i');
        for (let scan = index; scan < lines.length; scan += 1) {
          if (closer.test(lines[scan]!)) {
            last = scan;
            closed = true;
            break;
          }
        }
      }
      // No closing tag anywhere below — which is what every keystroke of
      // `<div` looks like while it is still being typed. Ending at the first
      // blank line keeps the rest of the note in blocks of its own; running to
      // the end of the file would collapse the whole document into this one.
      if (!closed) {
        while (last + 1 < lines.length && !isBlank(lines[last + 1]!)) last += 1;
      }
      push(
        /^ {0,3}<(img|figure)\b/i.test(line) ? 'image' : 'html',
        index,
        last,
      );
      index = last + 1;
      continue;
    }

    // --- Heading / divider: always a single line ---------------------------
    const heading = HEADING.exec(line);
    if (heading) {
      push('heading', index, index, heading[1]!.length);
      index += 1;
      continue;
    }
    if (DIVIDER.test(line)) {
      push('divider', index, index);
      index += 1;
      continue;
    }

    // --- Blockquote: contiguous `>` lines and their lazy continuations -----
    if (QUOTE.test(line)) {
      let last = index;
      while (
        last + 1 < lines.length &&
        !isBlank(lines[last + 1]!) &&
        (QUOTE.test(lines[last + 1]!) || !isListLine(lines[last + 1]!))
      ) {
        last += 1;
      }
      push('quote', index, last);
      index = last + 1;
      continue;
    }

    // --- Lists: items, their indented continuations, and loose gaps --------
    if (isListLine(line)) {
      const base = indentWidth(line);
      let last = index;
      let scan = index + 1;
      while (scan < lines.length) {
        const candidate = lines[scan]!;
        if (isBlank(candidate)) {
          // A single blank line keeps the list together when the next line is
          // still part of it — that is a loose list, not two blocks.
          const next = lines[scan + 1];
          if (
            next !== undefined &&
            !isBlank(next) &&
            (isListLine(next) || indentWidth(next) > base) &&
            indentWidth(next) >= base
          ) {
            scan += 2;
            last = scan - 1;
            continue;
          }
          break;
        }
        if (isListLine(candidate) && indentWidth(candidate) >= base) {
          last = scan;
          scan += 1;
          continue;
        }
        // An indented continuation line belongs to the item above it.
        if (indentWidth(candidate) > base) {
          last = scan;
          scan += 1;
          continue;
        }
        break;
      }
      push(classifyList(lines.slice(index, last + 1)), index, last);
      index = last + 1;
      continue;
    }

    // --- Paragraph, table, or a lone image ---------------------------------
    let last = index;
    while (
      last + 1 < lines.length &&
      !isBlank(lines[last + 1]!) &&
      !FENCE.test(lines[last + 1]!) &&
      !HEADING.test(lines[last + 1]!) &&
      !DIVIDER.test(lines[last + 1]!) &&
      !isListLine(lines[last + 1]!) &&
      !QUOTE.test(lines[last + 1]!)
    ) {
      last += 1;
    }
    const body = lines.slice(index, last + 1);
    const isTable =
      body.length >= 2 &&
      body[0]!.includes('|') &&
      TABLE_DELIMITER.test(body[1]!);
    const isImage = body.length === 1 && IMAGE_ONLY.test(body[0]!.trim());
    push(isTable ? 'table' : isImage ? 'image' : 'paragraph', index, last);
    index = last + 1;
  }

  return blocks;
}

/** The block containing `offset`, or the one nearest before it. */
export function blockAtOffset(
  blocks: StudioBlock[],
  offset: number,
): StudioBlock | null {
  let best: StudioBlock | null = null;
  for (const block of blocks) {
    if (block.start <= offset && offset <= block.end) return block;
    if (block.end < offset) best = block;
  }
  return best ?? blocks[0] ?? null;
}

/**
 * Every block an open range covers, as a first and last index, or null.
 *
 * Usually one block. But what sits in the open editor is *source*, and source
 * re-parses as it is typed: add a newline and a `- ` to a paragraph and the
 * range now spans a paragraph and a list. The editor stands in for all of
 * them, so the caller has to take all of them out of the rendered column —
 * replacing only the first leaves the rest on screen underneath, mirroring
 * every keystroke back at the writer.
 *
 * A collapsed range is a slot that was opened and not yet written in. It sits
 * between blocks, so no block contains it and the answer is honestly "none"
 * rather than the block that happens to end there.
 */
export function activeBlockSpan(
  blocks: StudioBlock[],
  range: BlockRange | null,
): { first: number; last: number } | null {
  if (!range) return null;
  if (range.start === range.end) {
    const at = blocks.findIndex(
      (block) => block.start <= range.start && range.start <= block.end,
    );
    return at === -1 ? null : { first: at, last: at };
  }
  let first = -1;
  let last = -1;
  blocks.forEach((block, index) => {
    if (block.end > range.start && block.start < range.end) {
      if (first === -1) first = index;
      last = index;
    }
  });
  return first === -1 ? null : { first, last };
}

/** Replace `[start, end)` of `doc`. The only way the visual editor writes. */
export function spliceRange(
  doc: string,
  start: number,
  end: number,
  text: string,
): string {
  return doc.slice(0, start) + text + doc.slice(end);
}

/**
 * Where a rendered block's plain text offset lands in its Markdown source.
 *
 * Rendered text is very nearly a subsequence of the source — markup characters
 * (`**`, `[`, `](url)`) are dropped, the visible characters survive in order —
 * so a two-pointer walk aligns them without parsing. Entities and other
 * rewrites can desynchronize it; the walk is bounded by the source length, so
 * the worst case is a caret that lands at the end of the block rather than a
 * wrong document.
 */
export function sourceOffsetForText(
  raw: string,
  text: string,
  textOffset: number,
): number {
  let source = 0;
  let matched = 0;
  const target = Math.min(textOffset, text.length);
  while (source < raw.length && matched < target) {
    const wanted = text[matched]!;
    const found = raw[source]!;
    if (found === wanted) {
      source += 1;
      matched += 1;
      continue;
    }
    // Rendered whitespace may stand for a newline or a run of spaces.
    if (/\s/.test(wanted) && /\s/.test(found)) {
      source += 1;
      matched += 1;
      continue;
    }
    source += 1;
  }
  return source;
}

// --- Task lists -----------------------------------------------------------

const TASK_MARKER = /^(\s*[-*+]\s+\[)([ xX])(\])/;

/** Flip the nth checkbox in a block, counting from zero. */
export function toggleTaskInBlock(raw: string, index: number): string {
  let seen = -1;
  return raw
    .split('\n')
    .map((line) => {
      const match = TASK_MARKER.exec(line);
      if (!match) return line;
      seen += 1;
      if (seen !== index) return line;
      const next = match[2] === ' ' ? 'x' : ' ';
      return `${match[1]}${next}${line.slice(match[1]!.length + 1)}`;
    })
    .join('\n');
}

/**
 * Make the checkboxes `marked` renders clickable. It emits them `disabled`,
 * which is right for a published page and wrong for an editor: a disabled
 * input fires no events at all, so the box could not be ticked without opening
 * the source. Each one is numbered so a click maps back to a source line.
 */
export function enableTaskCheckboxes(html: string): string {
  let index = -1;
  return html.replace(/<input\b[^>]*>/g, (tag) => {
    if (!/type="checkbox"/.test(tag)) return tag;
    index += 1;
    return tag
      .replace(/\sdisabled(?:=""|='')?/g, '')
      .replace(/^<input/, `<input data-task="${index}"`);
  });
}

// --- Typing behaviour inside a block --------------------------------------

export interface TextEdit {
  /** Range in the block's own text to replace. */
  from: number;
  to: number;
  insert: string;
  /** Caret offset in the block after the edit. Defaults to end of `insert`. */
  caret?: number;
}

function lineStartOf(value: string, offset: number): number {
  return value.lastIndexOf('\n', offset - 1) + 1;
}

function lineEndOf(value: string, offset: number): number {
  const found = value.indexOf('\n', offset);
  return found === -1 ? value.length : found;
}

/**
 * What Enter should do inside a list or quote: carry the marker down, or end
 * the run when the item is empty. Returns null when a plain newline is right.
 */
export function continueBlockOnEnter(
  value: string,
  caret: number,
): TextEdit | null {
  const from = lineStartOf(value, caret);
  const line = value.slice(from, lineEndOf(value, caret));

  // Enter on an empty item ends the run — but a nested one steps out a level
  // first, which is how you climb back to the top of a deep list by feel.
  const emptyItem = (indent: string, marker: string): TextEdit => {
    if (indent.length >= 2) {
      const lifted = `${indent.slice(2)}${marker}`;
      return { from, to: caret, insert: lifted, caret: from + lifted.length };
    }
    return { from, to: caret, insert: '', caret: from };
  };

  const task = TASK.exec(line);
  if (task) {
    const marker = `${task[2]}${task[3]}[ ] `;
    if (line.slice(task[0].length).trim() === '')
      return emptyItem(task[1]!, marker);
    return { from: caret, to: caret, insert: `\n${task[1]}${marker}` };
  }

  const bullet = BULLET.exec(line);
  if (bullet) {
    const marker = `${bullet[2]}${bullet[3]}`;
    if (line.slice(bullet[0].length).trim() === '')
      return emptyItem(bullet[1]!, marker);
    return { from: caret, to: caret, insert: `\n${bullet[1]}${marker}` };
  }

  const ordered = ORDERED.exec(line);
  if (ordered) {
    const marker = `${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`;
    if (line.slice(ordered[0].length).trim() === '')
      return emptyItem(ordered[1]!, `1${ordered[3]}${ordered[4]}`);
    return { from: caret, to: caret, insert: `\n${ordered[1]}${marker}` };
  }

  const quote = /^(\s*)(>\s?)/.exec(line);
  if (quote) {
    const content = line.slice(quote[0].length);
    if (content.trim() === '') {
      return { from, to: caret, insert: '', caret: from };
    }
    return { from: caret, to: caret, insert: `\n${quote[1]}${quote[2]}` };
  }

  return null;
}

/**
 * The pairs that wrap a selection when you type the opening character.
 *
 * Markdown's emphasis markers, and the two brackets a link is built from.
 * Quotes are deliberately absent: in prose, typing `"` over selected words far
 * more often means replacing them.
 */
const WRAP_PAIRS: Record<string, string> = {
  '*': '*',
  _: '_',
  '`': '`',
  '[': ']',
  '(': ')',
};

/** A selection, and the marker typed over it, with the caret range to keep. */
export interface WrapEdit extends TextEdit {
  /** End of the selection to restore, so the wrap can be repeated. */
  caretEnd: number;
}

/**
 * Typing `*` with words selected means emphasis, not "throw the words away".
 * Every editor worth using treats it that way, and it makes bold two taps of
 * the same key rather than a trip to the toolbar.
 *
 * Returns null when the key is not a wrap character or there is no selection —
 * in which case the browser's own insertion is exactly right.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  key: string,
): WrapEdit | null {
  const closing = WRAP_PAIRS[key];
  if (closing === undefined || start === end) return null;
  const selected = value.slice(start, end);
  // A selection spanning blank lines is several blocks; wrapping it would put
  // the markers where they cannot pair up.
  if (/\n\s*\n/.test(selected)) return null;
  return {
    from: start,
    to: end,
    insert: `${key}${selected}${closing}`,
    caret: start + key.length,
    caretEnd: start + key.length + selected.length,
  };
}

/** Tab / Shift-Tab over the selected lines, two spaces at a time. */
export function indentLines(
  value: string,
  start: number,
  end: number,
  direction: 1 | -1,
): TextEdit {
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end);
  const next = value
    .slice(from, to)
    .split('\n')
    .map((line) =>
      direction === 1 ? `  ${line}` : line.replace(/^ {1,2}|^\t/, ''),
    )
    .join('\n');
  return { from, to, insert: next, caret: from + next.length };
}

/**
 * Renumber an ordered list so the source reads 1, 2, 3 after an item is
 * inserted in the middle. Nested levels are numbered independently.
 */
export function renumberOrderedList(raw: string): string {
  const counters = new Map<number, number>();
  return raw
    .split('\n')
    .map((line) => {
      const match = ORDERED.exec(line);
      if (!match) return line;
      const depth = indentWidth(line);
      for (const key of counters.keys()) {
        if (key > depth) counters.delete(key);
      }
      const next = (counters.get(depth) ?? 0) + 1;
      counters.set(depth, next);
      return `${match[1]}${next}${match[3]}${match[4]}${line.slice(match[0].length)}`;
    })
    .join('\n');
}

/**
 * Enter in the middle of a block: the half above the caret is left behind as a
 * finished block, and the returned range is the half below it — the block the
 * caret carries on in. Whitespace either side of the split goes with the break
 * rather than starting the new block with a space.
 */
export function splitBlockAt(
  doc: string,
  range: BlockRange,
  caret: number,
): { doc: string; range: BlockRange } {
  const text = doc.slice(range.start, range.end);
  const before = text.slice(0, caret).replace(/\s+$/, '');
  const after = text.slice(caret).replace(/^\s+/, '');
  const start = range.start + before.length + 2;
  return {
    doc: spliceRange(doc, range.start, range.end, `${before}\n\n${after}`),
    range: { start, end: start + after.length },
  };
}

// --- Tables ---------------------------------------------------------------

/** Split a table row on its unescaped pipes, dropping the outer ones. */
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '\\' && line[index + 1] === '|') {
      cell += '\\|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  // A row written with the outer pipes has an empty cell at each end.
  if (cells[0]?.trim() === '') cells.shift();
  if (cells.length > 0 && cells.at(-1)?.trim() === '') cells.pop();
  return cells.map((value) => value.trim());
}

/** The `---`, `:--`, `--:` or `:-:` a delimiter cell should be written as. */
function delimiterFor(cell: string, width: number): string {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  const bar = '-'.repeat(Math.max(3, width - (left ? 1 : 0) - (right ? 1 : 0)));
  return `${left ? ':' : ''}${bar}${right ? ':' : ''}`;
}

/**
 * Line a table's pipes up.
 *
 * A Markdown table is only readable in source when its columns are, and they
 * stop being the moment a cell is edited. Every other Markdown editor tidies
 * this for you; doing it on blur means the source you come back to is the one
 * you would have written by hand, without the cursor jumping while you type.
 *
 * Anything that is not a well-formed table comes back untouched.
 */
export function formatTableBlock(raw: string): string {
  const lines = raw.split('\n');
  if (lines.length < 2 || !TABLE_DELIMITER.test(lines[1]!)) return raw;

  const rows = lines.map(tableCells);
  const columns = Math.max(...rows.map((row) => row.length));
  // The delimiter row carries alignment, not content, so it is sized to fit
  // rather than counted when working out how wide a column has to be.
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      3,
      // Counted in code points so an emoji or an accent does not throw the
      // column out by the number of units it happens to be stored in.
      ...rows.map((row, index) =>
        index === 1 ? 0 : [...(row[column] ?? '')].length,
      ),
    ),
  );

  return rows
    .map((row, index) => {
      const cells = Array.from({ length: columns }, (_, column) => {
        const value = row[column] ?? '';
        const width = widths[column]!;
        if (index === 1) return delimiterFor(value, width);
        // padEnd counts units, and the width is in code points; make up the
        // difference so a row holding an emoji still lines up.
        return value + ' '.repeat(Math.max(0, width - [...value].length));
      });
      return `| ${cells.join(' | ')} |`;
    })
    .join('\n');
}

// --- Changing what a block is ---------------------------------------------

export interface TurnTarget {
  type: BlockType;
  depth?: number;
}

const ANY_MARKER =
  /^(\s*)(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+)?/;

/** A line with whatever block marker it carries taken off the front. */
function bareLine(line: string): { indent: string; text: string } {
  const match = ANY_MARKER.exec(line);
  return {
    indent: match?.[1] ?? '',
    text: line.slice(match?.[0]?.length ?? 0),
  };
}

/**
 * Rewrite a block as another kind. Markers are swapped, never stacked: turning
 * a to-do list into a quote gives quoted text, not quoted checkboxes.
 */
export function turnBlockInto(raw: string, target: TurnTarget): string {
  if (target.type === 'code') {
    if (/^\s*```/.test(raw)) return raw;
    return '```\n' + raw + '\n```';
  }
  // A divider has no content to carry over, and it is one line however many
  // the block had — mapping it per line would leave a stack of rules.
  if (target.type === 'divider') return '---';
  const source = /^\s*```/.test(raw)
    ? raw.replace(/^\s*```[^\n]*\n?/, '').replace(/\n?\s*```\s*$/, '')
    : raw;

  return source
    .split('\n')
    .map((line, index) => {
      if (line.trim() === '') return line;
      const { indent, text } = bareLine(line);
      switch (target.type) {
        case 'heading':
          // A heading is one line: only the first gets the hashes.
          return index === 0
            ? `${indent}${'#'.repeat(target.depth ?? 2)} ${text}`
            : `${indent}${text}`;
        case 'list':
          return `${indent}- ${text}`;
        case 'task':
          return `${indent}- [ ] ${text}`;
        case 'quote':
          return `${indent}> ${text}`;
        default:
          return `${indent}${text}`;
      }
    })
    .join('\n');
}

// --- Block-level rearranging ----------------------------------------------

/**
 * Move the block at `index` one slot in `direction`, returning the new
 * document and the moved block's new range. Blank-line separators stay where
 * they are: only the two blocks' texts trade places.
 */
export function moveBlock(
  doc: string,
  blocks: StudioBlock[],
  index: number,
  direction: -1 | 1,
): { doc: string; range: BlockRange } | null {
  const source = blocks[index];
  const target = blocks[index + direction];
  if (!source || !target) return null;
  const [first, second] = direction === 1 ? [source, target] : [target, source];
  const gap = doc.slice(first.end, second.start);
  const next =
    doc.slice(0, first.start) +
    second.raw +
    gap +
    first.raw +
    doc.slice(second.end);
  const movedStart =
    direction === 1
      ? first.start + second.raw.length + gap.length
      : first.start;
  return {
    doc: next,
    range: { start: movedStart, end: movedStart + source.raw.length },
  };
}

/**
 * Lift the block at `from` out of the document and drop it before block `to`
 * (`to === blocks.length` appends). Used by the gutter drag handle. Only the
 * moved block and one separator are touched — the rest of the note, including
 * whatever spacing it was written with, is left alone.
 */
export function reorderBlocks(
  doc: string,
  blocks: StudioBlock[],
  from: number,
  to: number,
): { doc: string; range: BlockRange } | null {
  const moving = blocks[from];
  if (!moving || to === from || to === from + 1) return null;

  const after = blocks[from + 1];
  const before = blocks[from - 1];
  const cutStart = after ? moving.start : before ? before.end : moving.start;
  const cutEnd = after ? after.start : moving.end;

  const target = blocks[to];
  const anchor = target ? target.start : (blocks.at(-1)?.end ?? doc.length);
  const payload = target ? `${moving.raw}\n\n` : `\n\n${moving.raw}`;
  const offset = anchor > cutStart ? anchor - (cutEnd - cutStart) : anchor;

  const trimmed = doc.slice(0, cutStart) + doc.slice(cutEnd);
  const start = offset + (target ? 0 : 2);
  return {
    doc: trimmed.slice(0, offset) + payload + trimmed.slice(offset),
    range: { start, end: start + moving.raw.length },
  };
}

/**
 * Remove several blocks at once, along with the blank lines that framed them.
 *
 * Neighbouring blocks are taken out together rather than one at a time: the
 * separator between two blocks that are both going belongs to neither of them
 * afterwards, and removing it twice would eat the blank line before the block
 * that survives. So the selection is grouped into contiguous runs first, and
 * each run is lifted the way a single block would be.
 *
 * The runs are applied back to front, because removing text never moves the
 * offsets of anything before it — which is what lets the whole thing be one
 * splice sequence against one snapshot of the document, and so one undo step.
 */
export function deleteBlocks(
  doc: string,
  blocks: StudioBlock[],
  indices: readonly number[],
): { doc: string; caret: number } | null {
  const wanted = [...new Set(indices)]
    .filter((index) => blocks[index] !== undefined)
    .sort((a, b) => a - b);
  if (wanted.length === 0) return null;

  const runs: { first: number; last: number }[] = [];
  for (const index of wanted) {
    const open = runs.at(-1);
    if (open && index === open.last + 1) open.last = index;
    else runs.push({ first: index, last: index });
  }

  let next = doc;
  // Where the text closes up. Set by the earliest run, which is applied last
  // and whose offsets nothing after it can have moved.
  let caret = 0;
  for (let position = runs.length - 1; position >= 0; position -= 1) {
    const run = runs[position]!;
    const head = blocks[run.first]!;
    const tail = blocks[run.last]!;
    // A maximal run, so neither of these is going anywhere.
    const after = blocks[run.last + 1];
    const before = blocks[run.first - 1];
    const from = after ? head.start : before ? before.end : head.start;
    const to = after ? after.start : tail.end;
    next = spliceRange(next, from, to, '');
    caret = from;
  }
  return { doc: next, caret };
}

/** Remove a block along with one of the blank lines that framed it. */
export function deleteBlock(
  doc: string,
  blocks: StudioBlock[],
  index: number,
): { doc: string; caret: number } | null {
  return deleteBlocks(doc, blocks, [index]);
}

// --- Slash commands -------------------------------------------------------

/** The headings the menu groups commands under, in the order they appear. */
export type SlashGroup = 'Basic' | 'Lists' | 'Blocks' | 'Insert';

export interface SlashCommand {
  id: string;
  title: string;
  /** The Markdown this produces, shown as the row's glyph. */
  hint: string;
  keywords: string;
  group: SlashGroup;
  /** Markdown written in place of the `/query` token. */
  insert: string;
  /** Caret position relative to the start of `insert`. */
  caret?: number;
  /** Opens a dialog instead of inserting text. */
  action?: 'image' | 'link' | 'date';
}

const SLASH_GROUP_ORDER: SlashGroup[] = ['Basic', 'Lists', 'Blocks', 'Insert'];

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'text',
    title: 'Text',
    hint: 'Aa',
    keywords: 'text paragraph plain body',
    group: 'Basic',
    insert: '',
  },
  {
    id: 'h1',
    title: 'Heading 1',
    hint: '#',
    keywords: 'h1 title heading large',
    group: 'Basic',
    insert: '# ',
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: '##',
    keywords: 'h2 heading section',
    group: 'Basic',
    insert: '## ',
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: '###',
    keywords: 'h3 heading subsection small',
    group: 'Basic',
    insert: '### ',
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    hint: '-',
    keywords: 'ul bullet list item unordered',
    group: 'Lists',
    insert: '- ',
  },
  {
    id: 'ordered',
    title: 'Numbered list',
    hint: '1.',
    keywords: 'ol ordered number list steps',
    group: 'Lists',
    insert: '1. ',
  },
  {
    id: 'task',
    title: 'To-do list',
    hint: '[ ]',
    keywords: 'todo task checkbox check tick',
    group: 'Lists',
    insert: '- [ ] ',
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: '>',
    keywords: 'quote blockquote cite pull',
    group: 'Blocks',
    insert: '> ',
  },
  {
    id: 'code',
    title: 'Code block',
    hint: '```',
    keywords: 'code fence snippet pre syntax',
    group: 'Blocks',
    insert: '```\n\n```',
    caret: 4,
  },
  {
    id: 'table',
    title: 'Table',
    hint: '|',
    keywords: 'table grid rows columns',
    group: 'Blocks',
    // Written pre-aligned, the way the formatter would leave it.
    insert:
      '| Column  | Column  |\n| ------- | ------- |\n| Cell    | Cell    |',
    caret: 2,
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: '---',
    keywords: 'divider rule hr separator line break',
    group: 'Blocks',
    insert: '---',
  },
  {
    id: 'image',
    title: 'Image…',
    hint: '!',
    keywords: 'image picture photo upload figure media',
    group: 'Insert',
    insert: '',
    action: 'image',
  },
  {
    id: 'wikilink',
    title: 'Link to a note',
    hint: '[[',
    keywords: 'wikilink note internal link backlink',
    group: 'Insert',
    insert: '[[',
  },
  {
    id: 'link',
    title: 'Link',
    hint: '[]',
    keywords: 'link url href external web',
    group: 'Insert',
    insert: '[](https://)',
    caret: 1,
  },
  {
    id: 'date',
    title: "Today's date",
    hint: 'date',
    keywords: 'date today now timestamp day',
    group: 'Insert',
    insert: '',
    action: 'date',
  },
];

/**
 * The `/query` token under the caret, when it opens a line. Anything with a
 * space in it stops being a command — `/` is a legitimate character in prose.
 */
export function findSlashToken(
  value: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  const from = lineStartOf(value, caret);
  const before = value.slice(from, caret);
  const match = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*)?)\/([^\s/]*)$/.exec(
    before,
  );
  if (!match) return null;
  return {
    start: from + match[1]!.length,
    end: caret,
    query: match[2]!,
  };
}

/**
 * How well a command answers `needle`, or null when it does not. Higher wins.
 *
 * Ranked rather than filtered because the alternative is `/h` offering Heading
 * 1 fourth, behind every other row whose keywords happen to contain an h.
 */
function slashScore(command: SlashCommand, needle: string): number | null {
  const title = command.title.toLowerCase();
  if (command.id === needle) return 100;
  if (title.startsWith(needle)) return 80 - title.length;
  const words = command.keywords.split(' ');
  if (words.some((word) => word === needle)) return 60;
  if (words.some((word) => word.startsWith(needle))) return 40;
  if (title.includes(needle)) return 20;
  if (command.keywords.includes(needle)) return 10;
  return null;
}

/**
 * The commands worth showing for `/query`.
 *
 * With no query the full menu comes back in group order, so the shape of it is
 * learnable. With one it is ranked flat: what you typed is what you want at the
 * top, and a heading between it and the second-best answer only adds a row to
 * read past.
 */
export function matchSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return SLASH_COMMANDS.toSorted(
      (a, b) =>
        SLASH_GROUP_ORDER.indexOf(a.group) - SLASH_GROUP_ORDER.indexOf(b.group),
    );
  }
  return SLASH_COMMANDS.map((command) => ({
    command,
    score: slashScore(command, needle),
  }))
    .filter((row): row is { command: SlashCommand; score: number } => {
      return row.score !== null;
    })
    .toSorted((a, b) => b.score - a.score)
    .map((row) => row.command);
}

// --- Labels ---------------------------------------------------------------

const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  task: 'To-do list',
  quote: 'Quote',
  code: 'Code block',
  table: 'Table',
  divider: 'Divider',
  html: 'HTML',
  image: 'Image',
};

export function blockLabel(block: StudioBlock): string {
  if (block.type === 'heading') return `Heading ${block.depth ?? 1}`;
  return BLOCK_LABELS[block.type];
}
