// Calm writing as a TipTap extension: the dimming of everything but the line
// being written, and the typewriter scroll that keeps that line mid-page.
//
// Dimming is a ProseMirror decoration rather than a class toggled on DOM nodes,
// so it survives re-renders, never lands in the document, and costs nothing
// when focus mode is off. Preferences arrive from a shared store; the plugin
// view subscribes to it and asks ProseMirror to redraw, which is how a change
// in the popover reaches an editor that was built once.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Spotlight } from './studioFocusPrefs';
import { studioFocus, type FocusStore } from './studioFocusStore';
import { shouldFollowCaret, TypewriterScroll } from './studioTypewriter';

/** The class the stylesheet fades; named so the CSS and the plugin agree. */
export const DIMMED_CLASS = 'studio-focus-dim';

export interface DimRange {
  from: number;
  to: number;
}

interface Caret {
  from: number;
  to: number;
  empty: boolean;
}

/**
 * The blocks to dim: every one the selection does not touch. A caret on a
 * block's very edge (a gap cursor between two blocks) touches both, so
 * neither is left dark under it.
 *
 * `block` keeps a whole top-level block lit — a list, a quote, a table — and
 * `paragraph` goes inside containers to keep only the paragraph in them.
 */
export function dimmedRanges(
  doc: PMNode,
  caret: Caret,
  spotlight: Exclude<Spotlight, 'off'>,
): DimRange[] {
  const touches = (from: number, to: number) =>
    caret.empty
      ? caret.from >= from && caret.from <= to
      : caret.to > from && caret.from < to;
  const ranges: DimRange[] = [];

  const visit = (parent: PMNode, start: number) => {
    parent.forEach((child, offset) => {
      const from = start + offset;
      const to = from + child.nodeSize;
      if (!touches(from, to)) ranges.push({ from, to });
      else if (spotlight === 'paragraph' && !child.isTextblock && !child.isLeaf)
        visit(child, from + 1);
    });
  };
  visit(doc, 0);
  return ranges;
}

interface FocusPluginState {
  decorations: DecorationSet;
  /** Bumped by each transaction that asks the page to follow the caret. */
  follow: number;
}

export const focusPluginKey = new PluginKey<FocusPluginState>('studioFocus');
const REFRESH = 'refresh';

export interface StudioFocusOptions {
  store: FocusStore;
}

export const StudioFocus = Extension.create<StudioFocusOptions>({
  name: 'studioFocus',

  addOptions() {
    return { store: studioFocus };
  },

  addProseMirrorPlugins() {
    const { store } = this.options;
    let lastKeyAt = 0;
    let typewriter: TypewriterScroll | null = null;

    const decorate = (doc: PMNode, caret: Caret): DecorationSet => {
      const { prefs, focusMode } = store.getState();
      if (!focusMode || prefs.spotlight === 'off') return DecorationSet.empty;
      return DecorationSet.create(
        doc,
        dimmedRanges(doc, caret, prefs.spotlight).map(({ from, to }) =>
          Decoration.node(from, to, { class: DIMMED_CLASS }),
        ),
      );
    };

    return [
      new Plugin<FocusPluginState>({
        key: focusPluginKey,
        state: {
          init: (_config, state) => ({
            decorations: decorate(state.doc, state.selection),
            follow: 0,
          }),
          apply(tr, value, _previous, state) {
            const refresh = tr.getMeta(focusPluginKey) === REFRESH;
            if (!tr.docChanged && !tr.selectionSet && !refresh) return value;
            const follows = shouldFollowCaret({
              docChanged: tr.docChanged,
              selectionSet: tr.selectionSet,
              pointer: Boolean(tr.getMeta('pointer')),
              uiEvent: tr.getMeta('uiEvent'),
              sinceKeyMs: Date.now() - lastKeyAt,
            });
            return {
              decorations: decorate(state.doc, state.selection),
              follow: value.follow + (follows ? 1 : 0),
            };
          },
        },
        props: {
          decorations: (state) => focusPluginKey.getState(state)?.decorations,
          // Escape is not handled here: leaving focus mode is one step in the
          // page's single Escape order (studioLayers), after find and the
          // outline, so one press never closes two things.
          handleKeyDown: () => {
            lastKeyAt = Date.now();
            return false;
          },
          handleDOMEvents: {
            // The text is final only when the IME lets go of it.
            compositionend: () => {
              setTimeout(() => typewriter?.request(), 30);
              return false;
            },
          },
        },
        view(view) {
          typewriter = new TypewriterScroll(
            view,
            () => store.getState().prefs.typewriter,
          );
          const unsubscribe = store.subscribe(() => {
            if (!view.isDestroyed)
              view.dispatch(view.state.tr.setMeta(focusPluginKey, REFRESH));
          });
          return {
            update(updated, previous) {
              const now = focusPluginKey.getState(updated.state)?.follow;
              if (now !== focusPluginKey.getState(previous)?.follow)
                typewriter?.request();
            },
            destroy() {
              unsubscribe();
              typewriter?.destroy();
              typewriter = null;
            },
          };
        },
      }),
    ];
  },
});
