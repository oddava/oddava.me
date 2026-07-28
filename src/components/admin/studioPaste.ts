// What the clipboard means, on the way in and on the way out.
//
// The note is Markdown, and the clipboard is almost never Markdown: it holds
// rich text from a browser, a bare URL, or the rendered text of a block copied
// out of this very editor. Pasting any of those verbatim throws away the thing
// that was copied. These are the conversions that keep a round trip honest.
//
// Everything DOM-dependent is confined to `markdownFromHtml`; the decisions
// around it are pure so they can be tested without a browser.

const BARE_URL = /^(?:https?:\/\/|mailto:)[^\s<>]+$/i;

/** A clipboard payload that is one link and nothing else. */
export function bareUrl(text: string): string | null {
  const trimmed = text.trim();
  return BARE_URL.test(trimmed) ? trimmed : null;
}

const MARKDOWN_SIGNS = [
  /(?:^|\n) {0,3}#{1,6}\s/, // heading
  /(?:^|\n) {0,3}(?:[-*+]|\d{1,9}[.)])\s/, // list
  /(?:^|\n) {0,3}>\s?/, // quote
  /(?:^|\n)\s*(?:```|~~~)/, // fence
  /\[[^\]\n]*\]\([^)\s]*\)/, // link
  /(?:\*\*|__)[^\s][^\n]*(?:\*\*|__)/, // strong
  /(?:^|\n)\s*\|.*\|\s*(?:\n|$)/, // table row
];

/**
 * Whether the plain-text half of a clipboard payload is already Markdown.
 *
 * Rich-text sources put a plain-text fallback alongside their HTML, and for a
 * web page that fallback is the visible words with the structure stripped —
 * converting the HTML recovers it. But an editor that copied Markdown also
 * ships HTML (its own rendering of that Markdown), and converting *that* would
 * round-trip the source through two lossy translations for nothing. When the
 * text is already Markdown it is the better of the two, every time.
 */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SIGNS.some((sign) => sign.test(text));
}

export interface PastePlan {
  /** Text to write in place of the selection. */
  text: string;
  /** Caret offset inside `text` afterwards. Defaults to its end. */
  caret?: number;
}

/**
 * Turn a resolved clipboard string into the edit it should become.
 *
 * The one transform worth making: a URL dropped onto selected words is a link
 * around those words. Everyone else's editor does this, and doing it by hand
 * means typing the brackets, cutting the text, and pasting it back.
 */
export function planPaste(pasted: string, selected: string): PastePlan | null {
  const text = pasted.replace(/\r\n?/g, '\n');
  if (!text) return null;

  const url = bareUrl(text);
  if (url && selected.trim() && !selected.includes('\n')) {
    const label = selected.trim();
    return { text: `[${label}](${url})`, caret: label.length + 3 + url.length };
  }
  return { text };
}

// --- Rich text in -----------------------------------------------------------

const INLINE_WRAP: Record<string, string> = {
  STRONG: '**',
  B: '**',
  EM: '_',
  I: '_',
  DEL: '~~',
  S: '~~',
  STRIKE: '~~',
};

/**
 * Escape the characters that would otherwise start Markdown of their own.
 *
 * `_` is deliberately absent: it is word-internal in identifiers far more often
 * than it is emphasis, GFM already declines to emphasise it there, and escaping
 * it turns every pasted `snake_case` into `snake\_case` in a source file the
 * author reads.
 */
function escapeText(value: string): string {
  return value.replace(/([\\`*[\]])/g, '\\$1');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function inlineOf(node: Node): string {
  if (node.nodeType === 3) return escapeText(collapse(node.nodeValue ?? ''));
  if (!isElement(node)) return '';
  const tag = node.tagName.toUpperCase();

  if (tag === 'BR') return '  \n';
  if (tag === 'IMG') {
    const src = node.getAttribute('src') ?? '';
    return src ? `![${node.getAttribute('alt') ?? ''}](${src})` : '';
  }
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') {
    const text = collapse(node.textContent ?? '');
    // A backtick inside the span needs a longer fence around it.
    const fence = '`'.repeat((/(`+)/.exec(text)?.[1]?.length ?? 0) + 1);
    return text ? `${fence}${text}${fence}` : '';
  }

  const inner = childrenOf(node).map(inlineOf).join('');
  if (tag === 'A') {
    const href = node.getAttribute('href') ?? '';
    const label = inner.trim();
    if (!href || !label) return inner;
    // A link whose text is its own address reads better bare.
    return href === label ? href : `[${label}](${href})`;
  }
  const wrap = INLINE_WRAP[tag];
  // Wrapping blank space produces markers with nothing between them, which
  // render as literal asterisks.
  if (wrap && inner.trim()) {
    const [, lead = '', core = '', tail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(
      inner,
    )!;
    return `${lead}${wrap}${core}${wrap}${tail}`;
  }
  return inner;
}

function childrenOf(node: Node): Node[] {
  return Array.from(node.childNodes);
}

function listOf(node: Element, indent: string): string {
  const ordered = node.tagName.toUpperCase() === 'OL';
  const start = Number(node.getAttribute('start') ?? '1') || 1;
  let index = start;
  const rows: string[] = [];
  for (const child of childrenOf(node)) {
    if (!isElement(child) || child.tagName.toUpperCase() !== 'LI') continue;
    const marker = ordered ? `${index}. ` : '- ';
    index += 1;
    // A nested list is a block inside the item; everything else is its text.
    const nested: string[] = [];
    const own: Node[] = [];
    for (const part of childrenOf(child)) {
      if (isElement(part) && /^(UL|OL)$/.test(part.tagName.toUpperCase())) {
        nested.push(listOf(part, `${indent}  `));
      } else {
        own.push(part);
      }
    }
    const text = own.map(inlineOf).join('').trim();
    const checkbox = child.querySelector?.('input[type="checkbox"]');
    const box = checkbox
      ? checkbox.hasAttribute('checked') ||
        (checkbox as HTMLInputElement).checked
        ? '[x] '
        : '[ ] '
      : '';
    rows.push(`${indent}${marker}${box}${text}`.trimEnd());
    rows.push(...nested.filter(Boolean));
  }
  return rows.join('\n');
}

function tableOf(node: Element): string {
  const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th, td')).map((cell) =>
      inlineOf(cell).replace(/\|/g, '\\|').trim(),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  const [head, ...body] = rows;
  return [
    pad(head!),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(pad),
  ].join('\n');
}

function blocksOf(node: Node): string[] {
  if (node.nodeType === 3) {
    const text = escapeText(collapse(node.nodeValue ?? ''));
    return text.trim() ? [text.trim()] : [];
  }
  if (!isElement(node)) return [];
  const tag = node.tagName.toUpperCase();

  if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/.test(tag)) return [];
  if (tag === 'HR') return ['---'];
  if (/^H[1-6]$/.test(tag)) {
    const text = inlineOf(node).trim();
    return text ? [`${'#'.repeat(Number(tag[1]))} ${text}`] : [];
  }
  if (tag === 'PRE') {
    const code = node.textContent ?? '';
    const language =
      /(?:^|\s)(?:language|lang)-([\w+-]+)/.exec(
        node.getAttribute('class') ?? '',
      )?.[1] ??
      /(?:^|\s)(?:language|lang)-([\w+-]+)/.exec(
        node.querySelector('code')?.getAttribute('class') ?? '',
      )?.[1] ??
      '';
    return ['```' + language + '\n' + code.replace(/\n+$/, '') + '\n```'];
  }
  if (tag === 'UL' || tag === 'OL') {
    const list = listOf(node, '');
    return list ? [list] : [];
  }
  if (tag === 'TABLE') {
    const table = tableOf(node);
    return table ? [table] : [];
  }
  if (tag === 'BLOCKQUOTE') {
    const inner = childrenOf(node).flatMap(blocksOf);
    if (inner.length === 0) return [];
    return [
      inner
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    ];
  }
  if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
    // A wrapper holding block children contributes nothing of its own.
    const hasBlockChild = childrenOf(node).some(
      (child) =>
        isElement(child) &&
        /^(P|DIV|SECTION|ARTICLE|UL|OL|TABLE|PRE|BLOCKQUOTE|H[1-6]|HR|FIGURE)$/.test(
          child.tagName.toUpperCase(),
        ),
    );
    if (hasBlockChild) return childrenOf(node).flatMap(blocksOf);
    const text = inlineOf(node).trim();
    return text ? [text] : [];
  }
  if (tag === 'FIGURE') {
    const image = node.querySelector('img');
    const caption = node.querySelector('figcaption')?.textContent?.trim();
    const src = image?.getAttribute('src') ?? '';
    if (!src) return childrenOf(node).flatMap(blocksOf);
    const alt = caption || image?.getAttribute('alt') || '';
    return [`![${alt}](${src})`];
  }
  if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN') {
    return childrenOf(node).flatMap(blocksOf);
  }

  const text = inlineOf(node).trim();
  return text ? [text] : [];
}

/**
 * Rich text as Markdown. Structure the note can express — headings, lists,
 * quotes, code, tables, links, images — comes across as Markdown; everything
 * else is flattened to its text rather than smuggled in as HTML.
 */
export function markdownFromHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return blocksOf(parsed.body)
    .filter((block) => block.trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The best Markdown this clipboard can offer. `plain` is ⌘⇧V — take the text
 * exactly as it is, which is the escape hatch for when a conversion guesses
 * wrong.
 */
export function markdownFromClipboard(
  data: DataTransfer | null,
  plain = false,
): string {
  const text = data?.getData('text/plain') ?? '';
  if (plain) return text;
  const html = data?.getData('text/html') ?? '';
  if (!html || looksLikeMarkdown(text)) return text;
  const converted = markdownFromHtml(html);
  // A conversion that came back with nothing useful is worse than the fallback.
  return converted.trim() ? converted : text;
}

// --- Rich text out ----------------------------------------------------------

export interface BlockSelection {
  /** Index of the first and last block the selection touches. */
  from: number;
  to: number;
  /** Offsets into those blocks' source, when the ends are partial. */
  fromOffset?: number;
  toOffset?: number;
}

/**
 * The Markdown behind a selection made across rendered blocks.
 *
 * Copying out of the surface otherwise yields the rendered text — the words
 * without the structure — so pasting a list back in gives a paragraph. Only
 * the two ends of a multi-block selection can be partial; everything between
 * them is taken whole.
 */
export function markdownForSelection(
  raws: string[],
  selection: BlockSelection,
): string {
  const from = Math.max(0, selection.from);
  const to = Math.min(raws.length - 1, selection.to);
  if (from > to) return '';
  if (from === to) {
    const raw = raws[from] ?? '';
    const start = clampOffset(selection.fromOffset ?? 0, raw);
    const end = clampOffset(selection.toOffset ?? raw.length, raw);
    return raw.slice(Math.min(start, end), Math.max(start, end));
  }
  const parts: string[] = [];
  for (let index = from; index <= to; index += 1) {
    const raw = raws[index] ?? '';
    if (index === from)
      parts.push(raw.slice(clampOffset(selection.fromOffset ?? 0, raw)));
    else if (index === to)
      parts.push(
        raw.slice(0, clampOffset(selection.toOffset ?? raw.length, raw)),
      );
    else parts.push(raw);
  }
  return parts.join('\n\n').trim();
}

function clampOffset(offset: number, raw: string): number {
  return Math.max(0, Math.min(offset, raw.length));
}
