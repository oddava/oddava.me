import { readColumns } from '../../lib/garden/columns';
// Lossless Markdown block parsing for RichDocument, plus the visual editor's
// block labels and slash-command catalog. Editing and history belong to
// ProseMirror; raw slices preserve source that the author has not changed.

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

    const columns = readColumns(markdown.slice(offsets[index]!));
    if (columns) {
      const last = index + columns.raw.split('\n').length - 1;
      push('html', index, last);
      index = last + 1;
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

export interface TurnTarget {
  type: BlockType;
  depth?: number;
}

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
