import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findInDoc, matchAtOrAfter, type FindMatch } from './studioFindMatch';

// Find-in-note as a plugin: the matches live in the editor's own state and are
// drawn as decorations, so the document is never touched to show them. Nothing
// here moves the selection — the caret stays where the writer left it, which
// is what lets Esc hand it back untouched — and a search never adds to the
// undo history, because only the replace commands change the document.

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  /** Index into `matches`, or -1 when there are none. */
  active: number;
  /** More matched than were kept: the counter says "of 2,000+". */
  capped: boolean;
  decorations: DecorationSet;
}

interface FindMeta {
  query?: string;
  caseSensitive?: boolean;
  /** Move the highlight to this match; the page and the question are as they were. */
  active?: number;
  /** Where to land after an edit that is a replacement: just past what it wrote. */
  anchor?: number;
}

export const findKey = new PluginKey<FindState>('studioFind');

const IDLE: FindState = {
  query: '',
  caseSensitive: false,
  matches: [],
  active: -1,
  capped: false,
  decorations: DecorationSet.empty,
};

function paint(doc: EditorState['doc'], matches: FindMatch[], active: number) {
  return DecorationSet.create(
    doc,
    matches.map(({ from, to }, index) =>
      Decoration.inline(from, to, {
        class:
          index === active
            ? 'studio-find-match is-active'
            : 'studio-find-match',
      }),
    ),
  );
}

function next(previous: FindState, tr: Transaction): FindState {
  const meta = tr.getMeta(findKey) as FindMeta | undefined;
  if (!meta && !tr.docChanged) return previous;
  const query = meta?.query ?? previous.query;
  if (!query) return IDLE;
  const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive;
  const retargeted =
    meta?.query !== undefined || meta?.caseSensitive !== undefined;

  if (!retargeted && !tr.docChanged && meta?.active !== undefined) {
    const active = Math.min(meta.active, previous.matches.length - 1);
    return {
      ...previous,
      active,
      decorations: paint(tr.doc, previous.matches, active),
    };
  }

  const { matches, capped } = findInDoc(tr.doc, query, { caseSensitive });
  // A new question lands after the caret; an edit lands after wherever the
  // highlight was (carried through the edit), so the match being read is not
  // lost to a keystroke elsewhere.
  const anchor =
    meta?.anchor ??
    (retargeted
      ? tr.selection.from
      : tr.mapping.map(previous.matches[previous.active]?.from ?? 0));
  const active =
    meta?.active !== undefined
      ? Math.min(meta.active, matches.length - 1)
      : matchAtOrAfter(matches, anchor);
  return {
    query,
    caseSensitive,
    matches,
    active,
    capped,
    decorations: paint(tr.doc, matches, active),
  };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    studioFind: {
      /** Search for `query`; an empty one clears the highlights. */
      setFind: (query: string, caseSensitive?: boolean) => ReturnType;
      /** Move the highlight to match `index`. */
      goToFind: (index: number) => ReturnType;
      replaceFind: (replacement: string) => ReturnType;
      replaceAllFind: (replacement: string) => ReturnType;
    };
  }
}

export const StudioFind = Extension.create({
  name: 'studioFind',

  addProseMirrorPlugins: () => [
    new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => IDLE,
        apply: (tr, previous) => next(previous, tr),
      },
      props: {
        decorations: (state) => findKey.getState(state)?.decorations ?? null,
      },
    }),
  ],

  // Commands only shape the transaction; TipTap dispatches it.
  addCommands() {
    return {
      setFind:
        (query, caseSensitive) =>
        ({ tr, state }) => {
          tr.setMeta(findKey, {
            query,
            caseSensitive:
              caseSensitive ?? findKey.getState(state)?.caseSensitive ?? false,
          } satisfies FindMeta);
          // A search is not an edit: keep it out of what Undo walks back.
          tr.setMeta('addToHistory', false);
          return true;
        },

      goToFind:
        (index) =>
        ({ tr, state }) => {
          if (!findKey.getState(state)?.matches.length) return false;
          tr.setMeta(findKey, { active: index } satisfies FindMeta);
          tr.setMeta('addToHistory', false);
          return true;
        },

      replaceFind:
        (replacement) =>
        ({ tr, state }) => {
          const found = findKey.getState(state);
          const match = found?.matches[found.active];
          if (!match) return false;
          // insertText takes the marks around the match, so a bold word stays
          // bold. The highlight moves on past the new text, so a replacement
          // that contains the query is not found and replaced again.
          tr.insertText(replacement, match.from, match.to);
          tr.setMeta(findKey, {
            anchor: match.from + replacement.length,
          } satisfies FindMeta);
          return true;
        },

      replaceAllFind:
        (replacement) =>
        ({ tr, state }) => {
          const found = findKey.getState(state);
          if (!found?.matches.length) return false;
          // Last to first, so no replacement shifts a position still to come;
          // one transaction, so one Undo puts every one of them back.
          for (const { from, to } of [...found.matches].reverse())
            tr.insertText(replacement, from, to);
          return true;
        },
    };
  },
});
