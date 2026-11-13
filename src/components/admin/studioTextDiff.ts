// A small line diff for the "what changed?" view. Notes are prose a person
// wrote, a few hundred lines at most, so a plain LCS over the lines that differ
// is plenty; the guard below exists only so a pathological paste cannot lock
// the tab.

export type DiffOp = { kind: 'same' | 'removed' | 'added'; line: string };

/** One aligned row: mine on the left, theirs on the right. */
export interface DiffRow {
  kind: 'same' | 'changed';
  mine: string | null;
  theirs: string | null;
}

/** A run of unchanged rows the view folds away. */
export interface DiffGap {
  kind: 'gap';
  count: number;
}

/** LCS table cells we are willing to allocate (about 8 MB of Uint16). */
const MAX_TABLE_CELLS = 4_000_000;

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

export function diffLines(mine: string, theirs: string): DiffOp[] {
  const a = toLines(mine);
  const b = toLines(theirs);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const head: DiffOp[] = a
    .slice(0, start)
    .map((line) => ({ kind: 'same', line }));
  const tail: DiffOp[] = a.slice(endA).map((line) => ({ kind: 'same', line }));
  return [
    ...head,
    ...diffMiddle(a.slice(start, endA), b.slice(start, endB)),
    ...tail,
  ];
}

function diffMiddle(a: string[], b: string[]): DiffOp[] {
  const removed = (lines: string[]): DiffOp[] =>
    lines.map((line) => ({ kind: 'removed', line }));
  const added = (lines: string[]): DiffOp[] =>
    lines.map((line) => ({ kind: 'added', line }));
  if (a.length === 0) return added(b);
  if (b.length === 0) return removed(a);
  const width = b.length + 1;
  if ((a.length + 1) * width > MAX_TABLE_CELLS) {
    return [...removed(a), ...added(b)];
  }

  // lcs[i][j] is the longest common run of a[i..] and b[j..].
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', line: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      ops.push({ kind: 'removed', line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'added', line: b[j]! });
      j += 1;
    }
  }
  return [...ops, ...removed(a.slice(i)), ...added(b.slice(j))];
}

/**
 * Pair each run of removed lines with the run of added lines that follows, so
 * an edited paragraph reads as one row changing rather than two unrelated ones.
 */
export function diffRows(mine: string, theirs: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const ops = diffLines(mine, theirs);
  for (let index = 0; index < ops.length;) {
    const op = ops[index]!;
    if (op.kind === 'same') {
      rows.push({ kind: 'same', mine: op.line, theirs: op.line });
      index += 1;
      continue;
    }
    const gone: string[] = [];
    const came: string[] = [];
    while (ops[index]?.kind === 'removed') gone.push(ops[index++]!.line);
    while (ops[index]?.kind === 'added') came.push(ops[index++]!.line);
    for (let row = 0; row < Math.max(gone.length, came.length); row += 1) {
      rows.push({
        kind: 'changed',
        mine: gone[row] ?? null,
        theirs: came[row] ?? null,
      });
    }
  }
  return rows;
}

export function hasChanges(rows: DiffRow[]): boolean {
  return rows.some((row) => row.kind === 'changed');
}

/** Keep `context` unchanged rows around each change and fold the rest. */
export function foldUnchanged(
  rows: DiffRow[],
  context = 2,
): Array<DiffRow | DiffGap> {
  const keep = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.kind !== 'changed') return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    for (let near = from; near <= to; near += 1) keep[near] = true;
  });

  const folded: Array<DiffRow | DiffGap> = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (hidden) folded.push({ kind: 'gap', count: hidden });
      hidden = 0;
      folded.push(row);
    } else {
      hidden += 1;
    }
  });
  if (hidden) folded.push({ kind: 'gap', count: hidden });
  return folded;
}
