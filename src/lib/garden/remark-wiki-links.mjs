const WIKI_LINK_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['\u0022]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function remarkGardenLinks() {
  return (tree) => visitTextNodes(tree);
}

function visitTextNodes(node) {
  if (!node || !Array.isArray(node.children)) return;

  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    if (child.type === 'text' && WIKI_LINK_PATTERN.test(child.value)) {
      WIKI_LINK_PATTERN.lastIndex = 0;
      const children = [];
      let cursor = 0;
      for (const match of child.value.matchAll(WIKI_LINK_PATTERN)) {
        const start = match.index ?? 0;
        if (start > cursor) {
          children.push({
            type: 'text',
            value: child.value.slice(cursor, start),
          });
        }
        const target = match[1].trim();
        children.push({
          type: 'link',
          url: '/notes/' + slugify(target),
          data: {
            hProperties: {
              className: ['wiki-link'],
              'data-wiki-target': target,
            },
          },
          children: [{ type: 'text', value: match[2]?.trim() || target }],
        });
        cursor = start + match[0].length;
      }
      if (cursor < child.value.length) {
        children.push({ type: 'text', value: child.value.slice(cursor) });
      }
      node.children.splice(index, 1, ...children);
      continue;
    }
    visitTextNodes(child);
  }
}
