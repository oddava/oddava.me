import type { Node as PMNode } from '@tiptap/pm/model';

export interface OutlineItem {
  /** The heading's position in the document: where a jump puts the caret. */
  pos: number;
  level: number;
  text: string;
}

/**
 * The note's headings in reading order, wherever they sit (a heading inside a
 * column or a quote is still a heading). Textblocks are never entered: nothing
 * inside one is a block.
 */
export function outlineOf(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      // A heading with no words is a line still being thought of, not a
      // destination worth listing.
      if (text) items.push({ pos, level: Number(node.attrs.level) || 1, text });
      return false;
    }
    return !node.isTextblock;
  });
  return items;
}

/**
 * How far in each heading sits. Measured from the shallowest level present
 * rather than from H1, so a note that starts at "##" is not pushed right by a
 * level nothing in it uses; and capped, so a stray jump from H1 to H5 does
 * not run the list off the panel.
 */
export function indentLevels(items: OutlineItem[], cap = 3): number[] {
  const top = Math.min(...items.map((item) => item.level));
  return items.map((item) => Math.min(item.level - top, cap));
}

/**
 * The section being read: the last heading at or before `position`, or -1
 * above the first one.
 */
export function sectionAt(items: OutlineItem[], position: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (items[middle]!.pos <= position) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

export function sameOutline(a: OutlineItem[], b: OutlineItem[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.pos === b[index]!.pos &&
        item.level === b[index]!.level &&
        item.text === b[index]!.text,
    )
  );
}
