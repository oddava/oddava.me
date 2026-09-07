/** Markdown containers shared by Studio, preview, and public notes. */
export function readColumns(source: string) {
  if (!source.startsWith(':::columns ')) return null;
  const lines = source.split('\n');
  const opening = /^:::columns (equal|left|right|three)\s*$/.exec(
    lines[0] ?? '',
  );
  if (!opening) return null;
  const columns: string[] = [];
  let start = 1;
  let depth = 0;
  let fence = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (
        new RegExp(
          `^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`,
        ).test(line)
      )
        fence = '';
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (/^:::columns /.test(line)) {
      depth++;
      continue;
    }
    if (line.trim() === ':::') {
      if (depth) {
        depth--;
        continue;
      }
      columns.push(lines.slice(start, i).join('\n').trim());
      if (columns.length < 2 || columns.length > 3) return null;
      const populated = columns.filter((column) => column.trim());
      const effective =
        columns.length === 3 && populated.length === 2 ? populated : columns;
      return {
        layout:
          effective.length === 3
            ? 'three'
            : opening[1] === 'three'
              ? 'equal'
              : opening[1]!,
        columns: effective,
        raw: lines.slice(0, i + 1).join('\n'),
      };
    }
    if (!depth && line.trim() === ':::column') {
      columns.push(lines.slice(start, i).join('\n').trim());
      start = i + 1;
    }
  }
  return null;
}
