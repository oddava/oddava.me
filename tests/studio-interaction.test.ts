// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { studioRichExtensions } from '../src/components/admin/studioRichExtensions';
import {
  richKeyDown,
  type RichKeymapContext,
} from '../src/components/admin/studioRichKeymap';
import type { WikiState } from '../src/components/admin/studioRichSuggestions';
import { BlockSelection } from '../src/components/admin/studioBlockSelection';
import {
  altShortcut,
  historyShortcuts,
  historyStep,
  isMod,
  shortcut,
} from '../src/components/admin/studioHelpers';
import {
  ESCAPE_ORDER,
  FLOATING,
  pickEscapeStep,
  registerEscape,
  type EscapeRank,
  type EscapeStep,
} from '../src/components/admin/studioLayers';
import {
  PICKER_GESTURE_MS,
  PICKER_SETTLE_MS,
  pickerScrollAction,
} from '../src/components/admin/studioPicker';
import {
  followsReference,
  footnoteAtCaret,
} from '../src/components/admin/studioFootnotes';
import { shortcutSections } from '../src/components/admin/StudioShortcuts';

const keys = (
  init: Partial<KeyboardEvent> & { key: string },
): Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
> => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe('isMod', () => {
  it('is only Ctrl off a Mac', () => {
    expect(isMod(keys({ key: 'f', ctrlKey: true }), false)).toBe(true);
    expect(isMod(keys({ key: 'f', metaKey: true }), false)).toBe(false);
    expect(isMod(keys({ key: 'f', ctrlKey: true, metaKey: true }), false)).toBe(
      false,
    );
  });

  it('is only ⌘ on a Mac, leaving Ctrl to text editing', () => {
    expect(isMod(keys({ key: 'f', metaKey: true }), true)).toBe(true);
    // Ctrl+F is "forward one character" in every Mac text field.
    expect(isMod(keys({ key: 'f', ctrlKey: true }), true)).toBe(false);
    expect(isMod(keys({ key: 'f', ctrlKey: true, metaKey: true }), true)).toBe(
      false,
    );
  });
});

describe('historyStep', () => {
  it('is Alt+← / Alt+→ off a Mac', () => {
    expect(historyStep(keys({ key: 'ArrowLeft', altKey: true }), false)).toBe(
      -1,
    );
    expect(historyStep(keys({ key: 'ArrowRight', altKey: true }), false)).toBe(
      1,
    );
    expect(
      historyStep(
        keys({ key: 'ArrowLeft', altKey: true, shiftKey: true }),
        false,
      ),
    ).toBe(0);
  });

  it('is ⌘[ / ⌘] on a Mac, never ⌥← (which moves by a word)', () => {
    expect(historyStep(keys({ key: '[', metaKey: true }), true)).toBe(-1);
    expect(historyStep(keys({ key: ']', metaKey: true }), true)).toBe(1);
    expect(historyStep(keys({ key: 'ArrowLeft', altKey: true }), true)).toBe(0);
    expect(historyStep(keys({ key: '[', ctrlKey: true }), true)).toBe(0);
  });

  it('labels match the keys', () => {
    expect(historyShortcuts(true)).toEqual(['⌘[', '⌘]']);
    expect(historyShortcuts(false)).toEqual(['Alt+←', 'Alt+→']);
    expect(shortcut('X', true, true)).toBe('⌘⇧X');
    expect(shortcut('X', true, false)).toBe('Ctrl+Shift+X');
    expect(altShortcut('↑', false)).toBe('Alt+↑');
  });
});

describe('the Escape order', () => {
  const step = (open: boolean) => ({
    isOpen: () => open,
    close: vi.fn(),
  });
  const escape = { key: 'Escape', isComposing: false };

  it('goes innermost first: panel, then focus mode, then the sidebar', () => {
    expect(ESCAPE_ORDER).toEqual(['panel', 'focus', 'sidebar']);
    const panel = step(true);
    const focus = step(true);
    const sidebar = step(true);
    const steps = new Map<EscapeRank, EscapeStep[]>([
      ['sidebar', [sidebar]],
      ['focus', [focus]],
      ['panel', [panel]],
    ]);
    expect(pickEscapeStep(escape, false, steps)).toBe(panel);
    steps.set('panel', [step(false)]);
    expect(pickEscapeStep(escape, false, steps)).toBe(focus);
    steps.set('focus', [step(false)]);
    expect(pickEscapeStep(escape, false, steps)).toBe(sidebar);
  });

  it('leaves the key to anything floating, and to an IME', () => {
    const steps = new Map<EscapeRank, EscapeStep[]>([['focus', [step(true)]]]);
    expect(pickEscapeStep(escape, true, steps)).toBeNull();
    expect(
      pickEscapeStep({ key: 'Escape', isComposing: true }, false, steps),
    ).toBeNull();
    expect(
      pickEscapeStep(
        { key: 'Escape', isComposing: false, keyCode: 229 },
        false,
        steps,
      ),
    ).toBeNull();
    expect(
      pickEscapeStep({ key: 'Enter', isComposing: false }, false, steps),
    ).toBeNull();
  });

  it('closes exactly one thing per press, page-wide', () => {
    let findOpen = true;
    let focusMode = true;
    const offFind = registerEscape('panel', {
      isOpen: () => findOpen,
      close: () => (findOpen = false),
    });
    const offFocus = registerEscape('focus', {
      isOpen: () => focusMode,
      close: () => (focusMode = false),
    });
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event;
    };
    expect(press().defaultPrevented).toBe(true);
    expect([findOpen, focusMode]).toEqual([false, true]);
    press();
    expect([findOpen, focusMode]).toEqual([false, false]);

    // A menu on screen owns the key: nothing underneath moves.
    findOpen = true;
    const menu = document.createElement('div');
    menu.setAttribute('data-studio-layer', 'menu');
    document.body.append(menu);
    expect(document.querySelector(FLOATING)).toBe(menu);
    expect(press().defaultPrevented).toBe(false);
    expect(findOpen).toBe(true);
    menu.remove();
    offFind();
    offFocus();
  });
});

describe('pickerScrollAction', () => {
  it('only repositions while the page settles after opening', () => {
    expect(
      pickerScrollAction({
        sinceOpenMs: PICKER_SETTLE_MS - 1,
        sinceGestureMs: 0,
        insidePicker: false,
      }),
    ).toBe('reposition');
  });

  it('closes on a scroll the writer made outside the list', () => {
    expect(
      pickerScrollAction({
        sinceOpenMs: PICKER_SETTLE_MS + 1,
        sinceGestureMs: 10,
        insidePicker: false,
      }),
    ).toBe('close');
  });

  it('ignores the keyboard pushing the page and scrolls inside the list', () => {
    expect(
      pickerScrollAction({
        sinceOpenMs: 5000,
        sinceGestureMs: PICKER_GESTURE_MS + 1,
        insidePicker: false,
      }),
    ).toBe('reposition');
    expect(
      pickerScrollAction({
        sinceOpenMs: 5000,
        sinceGestureMs: 0,
        insidePicker: true,
      }),
    ).toBe('ignore');
  });
});

describe('footnote references', () => {
  it('follow at once under a mouse, and only once selected under a finger', () => {
    expect(followsReference(false, null, 4)).toBe(true);
    expect(followsReference(true, null, 4)).toBe(false);
    expect(followsReference(true, 9, 4)).toBe(false);
    expect(followsReference(true, 4, 4)).toBe(true);
  });
});

describe('the shortcut sheet', () => {
  const rows = shortcutSections().flatMap((section) => section.rows);
  const keysFor = (label: string) =>
    rows.find(([name]) => name === label)?.[1] ?? '';

  it('lists every way to step through matches', () => {
    expect(keysFor('Next / previous match')).toContain('F3');
    expect(keysFor('Next / previous match')).toContain(shortcut('G'));
  });

  it('lists replace, page style, and the Markdown for callouts, footnotes and tags', () => {
    const labels = rows.map(([name]) => name);
    expect(labels).toContain('Replace');
    expect(labels).toContain('Page style and typewriter scroll');
    expect(rows.map(([, combo]) => combo)).toEqual(
      expect.arrayContaining(['> [!NOTE]', '[^1]', '#tag']),
    );
  });

  it('teaches the keys the editor actually binds', () => {
    expect(keysFor('Strikethrough')).toBe(shortcut('X', true));
    expect(keysFor('Inline code')).toContain(shortcut('E'));
    expect(keysFor('Search notes and commands')).toBe(shortcut('P'));
  });
});

// --- The editor's keymap, on a real editor ---------------------------------

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

function build(content: object) {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: studioRichExtensions({
      renderMarkdown: () => '',
      onImageActions: () => {},
    }),
    content,
  });
  editors.push(editor);
  const context = {
    slashRef: { current: null },
    wikiRef: { current: null as WikiState | null },
    dismissed: { current: null },
    setSlash: vi.fn(),
    setWiki: vi.fn(),
    chooseRef: { current: vi.fn() },
    chooseWikiRef: { current: vi.fn() },
    moveRef: { current: vi.fn() },
    cancelBlockDrag: () => false,
    clearHandle: vi.fn(),
    deleteBlockAt: vi.fn(),
    showLink: vi.fn(),
    save: vi.fn(),
  } satisfies RichKeymapContext;
  return { editor, context };
}

function key(init: KeyboardEventInit & { key: string }) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const stop = vi.spyOn(event, 'stopPropagation');
  return { event, stop };
}

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('richKeyDown', () => {
  it('saves on Mod+S and never on Mod+Shift+S', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('Words')],
    });
    const shifted = key({ key: 'S', ctrlKey: true, shiftKey: true });
    richKeyDown(editor, shifted.event, context);
    expect(context.save).not.toHaveBeenCalled();
    const plain = key({ key: 's', ctrlKey: true });
    expect(richKeyDown(editor, plain.event, context)).toBe(true);
    expect(context.save).toHaveBeenCalledOnce();
  });

  it('binds Mod+Shift+X to strikethrough and keeps it from the browser', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('Struck words')],
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });
    const { event } = key({ key: 'X', ctrlKey: true, shiftKey: true });
    expect(richKeyDown(editor, event, context)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.isActive('strike')).toBe(true);
  });

  it('leaves Enter to the newline in a #tag menu until a row is picked', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('fixed in #design')],
    });
    context.wikiRef.current = {
      kind: 'tag',
      from: 10,
      to: 17,
      query: 'design',
      point: { top: 0, left: 0 },
      index: 0,
      items: [
        { id: 'design', title: '#design', folder: '', insert: '#design ' },
        {
          id: 'design-systems',
          title: '#design-systems',
          folder: '',
          insert: '#design-systems ',
        },
      ],
    };
    const enter = key({ key: 'Enter' });
    expect(richKeyDown(editor, enter.event, context)).toBe(false);
    expect(enter.event.defaultPrevented).toBe(false);
    expect(context.chooseWikiRef.current).not.toHaveBeenCalled();
    expect(context.setWiki).toHaveBeenCalledWith(null);

    // Tab takes the top row — the tag typed in full.
    const tab = key({ key: 'Tab' });
    expect(richKeyDown(editor, tab.event, context)).toBe(true);
    expect(context.chooseWikiRef.current).toHaveBeenCalledWith(0);

    // After the arrows chose a row, Enter takes it.
    context.wikiRef.current = {
      ...context.wikiRef.current,
      index: 1,
      moved: true,
    };
    const picked = key({ key: 'Enter' });
    expect(richKeyDown(editor, picked.event, context)).toBe(true);
    expect(context.chooseWikiRef.current).toHaveBeenLastCalledWith(1);
  });

  it('marks a row as picked when the arrows move through a #tag menu', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('#de')],
    });
    context.wikiRef.current = {
      kind: 'tag',
      from: 1,
      to: 4,
      query: 'de',
      point: { top: 0, left: 0 },
      index: 0,
      items: [
        { id: 'design', title: '#design', folder: '', insert: '#design ' },
        { id: 'devlog', title: '#devlog', folder: '', insert: '#devlog ' },
      ],
    };
    richKeyDown(editor, key({ key: 'ArrowDown' }).event, context);
    expect(context.setWiki).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, moved: true }),
    );
  });

  it('stops the Escape that clears a block selection', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('One'), paragraph('Two')],
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new BlockSelection(editor.state.doc, [
          0,
          editor.state.doc.child(0).nodeSize,
        ]),
      ),
    );
    const { event, stop } = key({ key: 'Escape' });
    expect(richKeyDown(editor, event, context)).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(editor.state.selection).not.toBeInstanceOf(BlockSelection);
  });

  it('stops the Escape that ends a block drag', () => {
    const { editor, context } = build({
      type: 'doc',
      content: [paragraph('One')],
    });
    const { event, stop } = key({ key: 'Escape' });
    expect(
      richKeyDown(editor, event, { ...context, cancelBlockDrag: () => true }),
    ).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  describe('in a footnote', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Claim' },
            { type: 'footnoteRef', attrs: { id: '1' } },
          ],
        },
        {
          type: 'footnoteDefinition',
          attrs: { id: '1' },
          content: [paragraph('The source.')],
        },
      ],
    };
    const intoFootnote = (editor: Editor) => {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === 'footnoteDefinition') at = pos + 3;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, at),
        ),
      );
    };
    const onReference = (editor: Editor) => {
      const { selection } = editor.state;
      return (
        selection instanceof NodeSelection &&
        selection.node.type.name === 'footnoteRef'
      );
    };

    it('knows which footnote holds the caret', () => {
      const { editor } = build(doc);
      expect(footnoteAtCaret(editor)).toBeNull();
      intoFootnote(editor);
      expect(footnoteAtCaret(editor)).toBe('1');
    });

    it('goes back to the reference on Escape, and stops the key', () => {
      const { editor, context } = build(doc);
      intoFootnote(editor);
      const { event, stop } = key({ key: 'Escape' });
      expect(richKeyDown(editor, event, context)).toBe(true);
      expect(stop).toHaveBeenCalled();
      expect(onReference(editor)).toBe(true);
    });

    it('goes back on Mod+Enter instead of breaking the line', () => {
      const { editor, context } = build(doc);
      intoFootnote(editor);
      const { event } = key({ key: 'Enter', ctrlKey: true });
      expect(richKeyDown(editor, event, context)).toBe(true);
      expect(onReference(editor)).toBe(true);
    });

    it('leaves Escape to whatever is open on the page', () => {
      const { editor, context } = build(doc);
      intoFootnote(editor);
      const find = document.createElement('div');
      find.setAttribute('data-studio-layer', 'panel');
      document.body.append(find);
      expect(richKeyDown(editor, key({ key: 'Escape' }).event, context)).toBe(
        false,
      );
      expect(onReference(editor)).toBe(false);
    });
  });
});
