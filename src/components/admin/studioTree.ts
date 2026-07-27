// The file explorer's data model, kept out of the component that draws it.
//
// Rendering and keyboard navigation used to derive "what is on screen" twice —
// once while drawing children, once while flattening rows for shift-click — and
// the two predicates drifted apart, so a search could match a row the keyboard
// could not reach. Everything here is pure and produces *one* filtered tree that
// both the markup and the row list read from, which is what keeps them honest.

import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import type { StudioTreeItemRef } from './studioDragItems';

export interface FolderNode {
  kind: 'folder';
  folder: ContentFolder;
  /** The entry that serves as the folder's own page, when it has one. */
  document?: ContentEntryListItem;
}

export interface EntryNode {
  kind: 'entry';
  entry: ContentEntryListItem;
}

export type TreeNode = FolderNode | EntryNode;

/** Children keyed by folder path; the root folder's path is `''`. */
export type TreeChildren = Map<string, TreeNode[]>;

/** The root row's key. Not a node — the root folder has no node of its own. */
export const ROOT_KEY = 'root';

/** The root folder's real id is `''`, which an option list cannot round-trip. */
export const ROOT_OPTION = '::root';

const KEY_SEPARATOR = ':';

export function humanize(value: string): string {
  return value.replaceAll('-', ' ');
}

export function nodeRef(node: TreeNode): StudioTreeItemRef {
  return node.kind === 'folder'
    ? { kind: 'folder', id: node.folder.id }
    : { kind: 'entry', id: node.entry.id };
}

export function sameItem(left: StudioTreeItemRef, right: StudioTreeItemRef) {
  return left.kind === right.kind && left.id === right.id;
}

export function itemKey(item: StudioTreeItemRef): string {
  return `${item.kind}${KEY_SEPARATOR}${item.id}`;
}

export function nodeKey(node: TreeNode): string {
  return itemKey(nodeRef(node));
}

/** The inverse of `itemKey` — a selection stores keys, mutations take refs. */
export function keyToItem(key: string): StudioTreeItemRef {
  const separator = key.indexOf(KEY_SEPARATOR);
  const id = key.slice(separator + 1);
  return key.slice(0, separator) === 'folder'
    ? { kind: 'folder', id }
    : { kind: 'entry', id };
}

export function nodeLabel(node: TreeNode): string {
  return humanize(node.kind === 'folder' ? node.folder.name : node.entry.id);
}

/** Where the node lives, spelled the way the store spells it. */
export function nodePath(node: TreeNode): string {
  return node.kind === 'folder' ? node.folder.id : node.entry.path;
}

/**
 * Everything a search looks at. A note's *title* is in here as well as its
 * slug: the title is what the row shows once you know the file, and what you
 * remember it by.
 */
export function nodeSearchText(node: TreeNode): string {
  return (
    node.kind === 'folder'
      ? `${nodeLabel(node)} ${node.folder.id}`
      : `${nodeLabel(node)} ${node.entry.title} ${node.entry.path}`
  ).toLowerCase();
}

function nodeOrder(node: TreeNode): number {
  const value = Number(
    node.kind === 'folder' ? node.document?.order : node.entry.order,
  );
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/** `'a/b/c'` → `['', 'a', 'a/b', 'a/b/c']`: every folder that has to be open. */
export function ancestorPaths(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const paths = [''];
  for (let i = 0; i < segments.length; i += 1) {
    paths.push(segments.slice(0, i + 1).join('/'));
  }
  return paths;
}

export function isInsideFolder(path: string, folder: string): boolean {
  return folder !== '' && (path === folder || path.startsWith(`${folder}/`));
}

export interface BuiltTree {
  children: TreeChildren;
  /** The collection's own `index` page, which the root row opens. */
  rootDocument?: ContentEntryListItem;
  /**
   * Rows the tree would show fully expanded. A folder's page and the root index
   * are part of a row rather than rows of their own, so this is smaller than
   * `entries.length` — and it is what the header count has to report.
   */
  itemCount: number;
}

/**
 * Fold the flat entry and folder lists into one tree. A folder whose parent
 * holds a same-named entry adopts that entry as its page, and the entry stops
 * being a row of its own — one folder, one row, whether or not it has a page.
 *
 * Siblings come out in the order the store keeps them: the stored `order` a
 * drag writes, and the name as the tie-break for anything that has never been
 * dragged.
 */
export function buildTree(
  folders: ContentFolder[],
  entries: ContentEntryListItem[],
): BuiltTree {
  const documents = new Map<string, ContentEntryListItem>();
  const consumedPaths = new Set<string>();
  const entriesByLocation = new Map(
    entries.map((entry) => [`${entry.folder}/${entry.id}`, entry]),
  );

  for (const folder of folders) {
    const parent = folder.parentId ?? '';
    const document = entriesByLocation.get(`${parent}/${folder.name}`);
    if (!document) continue;
    documents.set(folder.id, document);
    consumedPaths.add(`${document.folder}/${document.id}`);
  }

  const children: TreeChildren = new Map();
  children.set('', []);
  for (const folder of folders) children.set(folder.id, []);

  for (const folder of folders) {
    const parent = folder.parentId ?? '';
    const siblings = children.get(parent) ?? [];
    siblings.push({
      kind: 'folder',
      folder,
      document: documents.get(folder.id),
    });
    children.set(parent, siblings);
  }

  for (const entry of entries) {
    if (entry.folder === '' && entry.id === 'index') continue;
    if (consumedPaths.has(`${entry.folder}/${entry.id}`)) continue;
    const siblings = children.get(entry.folder) ?? [];
    siblings.push({ kind: 'entry', entry });
    children.set(entry.folder, siblings);
  }

  let itemCount = 0;
  for (const siblings of children.values()) {
    itemCount += siblings.length;
    siblings.sort(
      (left, right) =>
        nodeOrder(left) - nodeOrder(right) ||
        nodeLabel(left).localeCompare(nodeLabel(right)),
    );
  }

  return {
    children,
    rootDocument: entries.find(
      (entry) => entry.folder === '' && entry.id === 'index',
    ),
    itemCount,
  };
}

function keepSubtree(
  source: TreeChildren,
  parent: string,
  into: TreeChildren,
): void {
  const siblings = source.get(parent) ?? [];
  into.set(parent, siblings);
  for (const node of siblings) {
    if (node.kind === 'folder') keepSubtree(source, node.folder.id, into);
  }
}

/**
 * The tree a query leaves behind. A folder matched by name opens onto
 * everything it holds — you asked for the folder, not for the one file in it
 * whose name happens to repeat the folder's. A folder that only *leads* to a
 * match keeps the trail and nothing else.
 */
export function filterTree(source: TreeChildren, query: string): TreeChildren {
  const needle = query.trim().toLowerCase();
  if (!needle) return source;

  const filtered: TreeChildren = new Map();
  const visit = (parent: string): TreeNode[] => {
    const kept: TreeNode[] = [];
    for (const node of source.get(parent) ?? []) {
      const direct = nodeSearchText(node).includes(needle);
      if (node.kind === 'entry') {
        if (direct) kept.push(node);
        continue;
      }
      if (direct) {
        keepSubtree(source, node.folder.id, filtered);
        kept.push(node);
        continue;
      }
      if (visit(node.folder.id).length > 0) kept.push(node);
    }
    filtered.set(parent, kept);
    return kept;
  };
  visit('');
  return filtered;
}

export interface TreeRow {
  key: string;
  node: TreeNode;
  /** The folder this row sits in; `''` for a child of the root. */
  parent: string;
  /** 1 for a child of the root, matching `aria-level`. */
  depth: number;
  /** 1-based, for `aria-posinset`. */
  position: number;
  /** How many siblings share this row's parent, for `aria-setsize`. */
  siblings: number;
}

/**
 * Rows in the order they appear on screen — what shift-click selects a run of,
 * what the arrow keys walk, and what `aria-posinset` counts.
 */
export function flattenRows(
  children: TreeChildren,
  options: { expanded: ReadonlySet<string>; expandAll?: boolean },
): TreeRow[] {
  const rows: TreeRow[] = [];
  const isOpen = (path: string) =>
    Boolean(options.expandAll) || options.expanded.has(path);

  const walk = (parent: string, depth: number) => {
    const siblings = children.get(parent) ?? [];
    siblings.forEach((node, index) => {
      rows.push({
        key: nodeKey(node),
        node,
        parent,
        depth,
        position: index + 1,
        siblings: siblings.length,
      });
      if (node.kind === 'folder' && isOpen(node.folder.id)) {
        walk(node.folder.id, depth + 1);
      }
    });
  };

  if (isOpen('')) walk('', 1);
  return rows;
}

/** Every folder inside `root`, plus `root` itself — for a recursive expand. */
export function folderAndDescendants(
  folders: ContentFolder[],
  root: string,
): string[] {
  return folders
    .filter((folder) => folder.id === root || isInsideFolder(folder.id, root))
    .map((folder) => folder.id);
}

/**
 * Folders a move can land in. `excluded` names folders that are themselves
 * moving: a folder cannot become its own descendant.
 */
export function folderOptions(
  folders: ContentFolder[],
  excluded: string[] = [],
): { value: string; label: string; depth?: number }[] {
  return [
    { value: ROOT_OPTION, label: 'Notes' },
    ...folders
      .filter(
        (folder) =>
          !excluded.some(
            (root) => folder.id === root || isInsideFolder(folder.id, root),
          ),
      )
      .map((folder) => ({
        value: folder.id,
        label: humanize(folder.name),
        depth: folder.depth + 1,
      })),
  ];
}

export interface LabelPart {
  text: string;
  match: boolean;
}

/** A label split around every occurrence of the query, for `<mark>`. */
export function highlightParts(label: string, query: string): LabelPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text: label, match: false }];

  const haystack = label.toLowerCase();
  const parts: LabelPart[] = [];
  let at = 0;
  for (;;) {
    const found = haystack.indexOf(needle, at);
    if (found < 0) break;
    if (found > at) parts.push({ text: label.slice(at, found), match: false });
    parts.push({
      text: label.slice(found, found + needle.length),
      match: true,
    });
    at = found + needle.length;
  }
  if (at < label.length) parts.push({ text: label.slice(at), match: false });
  return parts.length > 0 ? parts : [{ text: label, match: false }];
}
