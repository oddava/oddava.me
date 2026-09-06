import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import StudioSlashMenu, {
  SLASH_MENU_ID,
  slashOptionId,
} from './StudioSlashMenu';
import StudioInlineToolbar from './StudioInlineToolbar';
import StudioBlockMenu from './StudioBlockMenu';
import WikiLinkAutocomplete from './WikiLinkAutocomplete';
import { useStudioMenu } from './useStudioMenu';
import {
  matchSlashCommands,
  parseBlocks,
  type SlashCommand,
  type TurnTarget,
} from './studioBlocks';
import { RichDocument, SourceBlock, WikiLink } from './studioRichDocument';
import { fuzzyScore } from './StudioCommandPalette';
import type { EditorCommands } from './studioEditorCommands';
import type {
  useWikiLinkAutocomplete,
  WikiSuggestion,
} from './useWikiLinkAutocomplete';
import { emissionsFrom, isOurs, remember } from './studioEmissions';
import { markdownFromClipboard } from './studioPaste';
import './StudioRichEditor.css';

interface Props {
  body: string;
  renderMarkdown: (raw: string) => string;
  editorRef: MutableRef<HTMLTextAreaElement | null>;
  richCommandsRef: MutableRef<EditorCommands | null>;
  focusRef: MutableRef<(() => void) | null>;
  commands: EditorCommands;
  wikiMenu: ReturnType<typeof useWikiLinkAutocomplete>;
  uploading: boolean;
  compact: boolean;
  visible: boolean;
  onChange: (next: string) => void;
  onShortcut: (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => boolean;
  onImageFile: (file: File) => void;
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: () => void;
  onNotice: (message: string) => void;
}

type Point = { top: number; left: number };
type Suggestion = {
  from: number;
  to: number;
  query: string;
  point: Point;
  index: number;
  items: SlashCommand[];
};
type WikiState = Omit<Suggestion, 'items'> & { items: WikiSuggestion[] };

function pointAt(editor: Editor, position: number, height = 310): Point {
  const rect = editor.view.coordsAtPos(position);
  const viewport = window.visualViewport;
  const bottom =
    (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
  return {
    top: Math.max(
      8,
      rect.bottom + height + 8 > bottom
        ? rect.top - height - 8
        : rect.bottom + 8,
    ),
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
  };
}

function topBlock(editor: Editor, position = editor.state.selection.from) {
  const $pos = editor.state.doc.resolve(
    Math.min(position, editor.state.doc.content.size),
  );
  const from = $pos.depth ? $pos.before(1) : $pos.pos;
  const node = editor.state.doc.nodeAt(from);
  return node ? { from, node } : null;
}

/** One continuous editing surface: the DOM and its selection belong to ProseMirror. */
export default function StudioVisualEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const live = useRef(props);
  live.current = props;
  const source = useRef(new RichDocument());
  const emitted = useRef(props.body);
  const emissions = useRef(emissionsFrom(props.body));
  const [slash, setSlash] = useState<Suggestion | null>(null);
  const [wiki, setWiki] = useState<WikiState | null>(null);
  const slashRef = useRef(slash);
  const wikiRef = useRef(wiki);
  slashRef.current = slash;
  wikiRef.current = wiki;
  const dismissed = useRef<number | null>(null);
  const [selectionPoint, setSelectionPoint] = useState<Point | null>(null);
  const [handle, setHandle] = useState<{ from: number; top: number } | null>(
    null,
  );
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const dragFrom = useRef<number | null>(null);
  const pointerDrag = useRef<{
    from: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressHandleClick = useRef(false);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const menu = useStudioMenu<number>();
  const [link, setLink] = useState<{
    from: number;
    to: number;
    url: string;
    point: Point;
  } | null>(null);
  const [linkError, setLinkError] = useState('');
  const [rawEdit, setRawEdit] = useState<{ from: number; raw: string } | null>(
    null,
  );
  const commandsRef = useRef<EditorCommands | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const chooseRef = useRef<(index: number) => void>(() => {});
  const chooseWikiRef = useRef<(index: number) => void>(() => {});
  const moveRef = useRef<(direction: -1 | 1) => void>(() => {});

  function updateHandle(editor: Editor, from: number) {
    const dom = editor.view.nodeDOM(from) as HTMLElement | null;
    const pane = scroller.current;
    if (!dom || !pane) return;
    setHandle({
      from,
      top:
        dom.getBoundingClientRect().top -
        pane.getBoundingClientRect().top +
        pane.scrollTop,
    });
  }

  function refresh() {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || !live.current.visible) return;
    const { selection } = editor.state;
    const { $from, from, to, empty } = selection;
    if (live.current.compact) {
      const block = topBlock(editor);
      if (block) updateHandle(editor, block.from);
    }
    const before = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      '\ufffc',
    );
    const slashMatch =
      empty && !editor.isActive('codeBlock') && /^\/([^\n/]*)$/.exec(before);
    if (slashMatch && dismissed.current !== $from.start()) {
      const query = slashMatch[1]!;
      const items = matchSlashCommands(query);
      setSlash((prev) => ({
        from: $from.start(),
        to: from,
        query,
        items,
        point: pointAt(editor, from),
        index:
          prev?.query === query
            ? Math.min(prev.index, Math.max(0, items.length - 1))
            : 0,
      }));
    } else {
      setSlash(null);
      if (!slashMatch) dismissed.current = null;
    }
    const wikiMatch =
      empty && !editor.isActive('codeBlock') && /\[\[([^\]\n|]*)$/.exec(before);
    if (wikiMatch && dismissed.current !== from - wikiMatch[0].length) {
      const query = wikiMatch[1]!;
      const items = live.current.wikiMenu.suggestions
        .map((item) => ({
          item,
          score: fuzzyScore(query, `${item.title} ${item.folder} ${item.id}`),
        }))
        .filter((row) => row.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 8)
        .map((row) => row.item);
      setWiki((prev) => ({
        from: from - wikiMatch[0].length,
        to: from,
        query,
        items,
        point: pointAt(editor, from),
        index:
          prev?.query === query
            ? Math.min(prev.index, Math.max(0, items.length - 1))
            : 0,
      }));
    } else setWiki(null);
    if (!empty && selection instanceof TextSelection && editor.isFocused) {
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      setSelectionPoint({
        top: Math.max(8, a.top - 46),
        left: Math.max(
          8,
          Math.min((a.left + b.left) / 2 - 110, window.innerWidth - 248),
        ),
      });
    } else setSelectionPoint(null);
    editor.view.dom.setAttribute(
      'aria-expanded',
      String(Boolean(slashMatch || wikiMatch)),
    );
  }
  refreshRef.current = refresh;

  function insertMarkdown(markdown: string) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const content = source.current.parse(editor, markdown).content ?? [];
    editor.chain().focus().insertContent(content).run();
  }

  function showLink() {
    const editor = editorRef.current;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setLinkError('');
    setLink({
      from,
      to,
      url: editor.getAttributes('link').href ?? '',
      point: pointAt(editor, from, 130),
    });
    setSelectionPoint(null);
  }

  function choose(index: number) {
    const editor = editorRef.current;
    const current = slashRef.current;
    const item = current?.items[index];
    if (!editor || !current || !item) return;
    // Deletion and conversion are one history event; focus stays in the document.
    editor
      .chain()
      .focus()
      .deleteRange({ from: current.from, to: current.to })
      .run();
    setSlash(null);
    const commands = commandsRef.current!;
    const actions: Record<string, () => void> = {
      text: () => editor.commands.setParagraph(),
      h1: () => commands.heading(1),
      h2: () => commands.heading(2),
      h3: () => commands.heading(3),
      bullet: commands.bulletList,
      ordered: commands.orderedList,
      task: commands.taskList,
      quote: commands.quote,
      code: commands.codeBlock,
      table: commands.table,
      divider: commands.divider,
      image: () => live.current.onRequestImage(),
      link: showLink,
      wikilink: () => editor.commands.insertContent('[['),
      date: () =>
        editor.commands.insertContent(
          new Date().toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        ),
    };
    actions[item.id]?.();
  }
  chooseRef.current = choose;

  function chooseWiki(index: number) {
    const editor = editorRef.current;
    const current = wikiRef.current;
    const item = current?.items[index];
    if (!editor || !current || !item) return;
    const target = /^\[\[([^|\]]+)/.exec(item.insert)?.[1] ?? item.id;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: current.from, to: current.to },
        {
          type: 'wikiLink',
          attrs: { target, label: item.title },
        },
      )
      .run();
    setWiki(null);
  }
  chooseWikiRef.current = chooseWiki;

  function moveBlock(direction: -1 | 1) {
    const editor = editorRef.current;
    if (!editor) return;
    const block = topBlock(editor, menu.key ?? editor.state.selection.from);
    if (!block) return;
    const { from, node } = block;
    const neighbor =
      direction < 0
        ? editor.state.doc.resolve(from).nodeBefore
        : editor.state.doc.nodeAt(from + node.nodeSize);
    if (!neighbor) return;
    const target =
      direction < 0 ? from - neighbor.nodeSize : from + neighbor.nodeSize;
    const tr = editor.state.tr
      .delete(from, from + node.nodeSize)
      .insert(target, node);
    tr.setSelection(NodeSelection.create(tr.doc, target));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    updateHandle(editor, target);
    live.current.onNotice(
      direction < 0 ? 'Block moved up.' : 'Block moved down.',
    );
  }
  moveRef.current = moveBlock;

  useEffect(() => {
    if (!host.current) return;
    const editor: Editor = new Editor({
      element: host.current,
      extensions: [
        StarterKit.configure({
          underline: false,
          trailingNode: false,
          link: { openOnClick: false },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image,
        TableKit,
        Markdown,
        SourceBlock,
        WikiLink,
        Placeholder.configure({
          placeholder: ({ node }) =>
            node.type.name === 'heading' ? 'Heading' : 'Type / for blocks…',
        }),
      ],
      content: '',
      injectCSS: false,
      editorProps: {
        attributes: {
          class: 'studio-rich-content prose',
          role: 'textbox',
          'aria-label': 'Note editor',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
        handleKeyDown: (_view, event) => {
          if (event.isComposing || editor.view.composing) return false;
          const current = slashRef.current ?? wikiRef.current;
          if (current) {
            if (
              ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Escape') {
                dismissed.current = current.from;
                setSlash(null);
                setWiki(null);
              } else if (event.key === 'Enter' || event.key === 'Tab') {
                if (current.items.length)
                  (slashRef.current ? chooseRef : chooseWikiRef).current(
                    current.index,
                  );
                else {
                  setSlash(null);
                  setWiki(null);
                }
              } else {
                const index =
                  (current.index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    current.items.length) %
                  Math.max(1, current.items.length);
                if (slashRef.current) setSlash({ ...slashRef.current, index });
                else if (wikiRef.current)
                  setWiki({ ...wikiRef.current, index });
              }
              return true;
            }
          }
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            moveRef.current(event.key === 'ArrowUp' ? -1 : 1);
            return true;
          }
          const mod = event.metaKey || event.ctrlKey;
          if (
            mod &&
            event.shiftKey &&
            ['d', 'Backspace'].includes(
              event.key === 'Backspace' ? event.key : event.key.toLowerCase(),
            )
          ) {
            const block = topBlock(editor);
            if (!block) return false;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Backspace')
              editor.commands.deleteRange({
                from: block.from,
                to: block.from + block.node.nodeSize,
              });
            else
              editor
                .chain()
                .insertContentAt(
                  block.from + block.node.nodeSize,
                  block.node.toJSON(),
                )
                .run();
            return true;
          }

          if (mod && event.key.toLowerCase() === 'k' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            showLink();
            return true;
          }
          if (mod && event.key.toLowerCase() === 's') {
            live.current.onShortcut(
              event as unknown as TargetedKeyboardEvent<HTMLTextAreaElement>,
            );
            return true;
          }
          if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
            event.preventDefault();
            editor.commands.toggleCode();
            return true;
          }
          if (event.key === 'Tab' && editor.isActive('taskItem')) {
            return event.shiftKey
              ? editor.commands.liftListItem('taskItem')
              : editor.commands.sinkListItem('taskItem');
          }
          if (event.key === 'Tab' && editor.isActive('listItem')) {
            return event.shiftKey
              ? editor.commands.liftListItem('listItem')
              : editor.commands.sinkListItem('listItem');
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const image = Array.from(event.clipboardData?.files ?? []).find(
            (file) => file.type.startsWith('image/'),
          );
          if (image) {
            void uploadAtSelection(image);
            return true;
          }
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (
            /^(https?:\/\/|mailto:)[^\s<>]+$/i.test(text.trim()) &&
            !editor.state.selection.empty
          ) {
            editor.commands.setLink({ href: text.trim() });
            return true;
          }
          // The schema's HTML parser handles normal rich clipboard contents.
          // Markdown-only clipboard payloads use the same import as mode switching.
          if (!event.clipboardData?.getData('text/html')) {
            const markdown = markdownFromClipboard(event.clipboardData);
            if (
              markdown.includes('\n') ||
              /^(# |\*\*|\[\[|```|- )/.test(markdown)
            ) {
              insertMarkdown(markdown);
              return true;
            }
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const from = dragFrom.current;
          dragFrom.current = null;
          setDropLine(null);
          const hit = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (from !== null) {
            const node = editor.state.doc.nodeAt(from);
            const destination = dropDestination(editor, event.clientY);
            if (!node || destination === null) return true;
            if (destination >= from && destination <= from + node.nodeSize)
              return true;
            const tr = editor.state.tr.delete(from, from + node.nodeSize);
            const target =
              destination > from ? destination - node.nodeSize : destination;
            tr.insert(target, node).setSelection(
              NodeSelection.create(tr.doc, target),
            );
            editor.view.dispatch(tr.scrollIntoView());
            editor.view.focus();
            return true;
          }
          const image = Array.from(event.dataTransfer?.files ?? []).find(
            (file) => file.type.startsWith('image/'),
          );
          if (image) {
            if (hit) editor.commands.setTextSelection(hit.pos);
            void uploadAtSelection(image);
            return true;
          }
          return false;
        },
        handleClickOn: (_view, _pos, node, nodePos, event) => {
          if (
            node.type.name !== 'sourceBlock' ||
            (event.detail !== 2 &&
              !(event.target as HTMLElement).closest('[data-edit-source]'))
          )
            return false;
          setRawEdit({ from: nodePos, raw: node.attrs.raw });
          return true;
        },
      },
      onUpdate: () => {
        const next = source.current.serialize(editor);
        emitted.current = next;
        remember(emissions.current, next);
        live.current.onChange(next);
        refreshRef.current();
      },
      onSelectionUpdate: () => refreshRef.current(),
      onFocus: () => refreshRef.current(),
      onBlur: () => setSelectionPoint(null),
    });
    editorRef.current = editor;
    editor.commands.setContent(
      source.current.parse(editor, live.current.body),
      { emitUpdate: false },
    );
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      }),
    );
    source.current.remember(editor, live.current.body);
    emitted.current = live.current.body;

    const commands: EditorCommands = {
      bold: () => {
        editor.chain().focus().toggleBold().run();
      },
      italic: () => {
        editor.chain().focus().toggleItalic().run();
      },
      strike: () => {
        editor.chain().focus().toggleStrike().run();
      },
      inlineCode: () => {
        editor.chain().focus().toggleCode().run();
      },
      heading: (level) => {
        editor.chain().focus().toggleHeading({ level }).run();
      },
      bulletList: () => {
        editor.chain().focus().toggleBulletList().run();
      },
      orderedList: () => {
        editor.chain().focus().toggleOrderedList().run();
      },
      taskList: () => {
        editor.chain().focus().toggleTaskList().run();
      },
      quote: () => {
        editor.chain().focus().toggleBlockquote().run();
      },
      codeBlock: () => {
        editor.chain().focus().toggleCodeBlock().run();
      },
      divider: () => {
        editor.chain().focus().setHorizontalRule().run();
      },
      table: () => {
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      },
      link: showLink,
      align: (direction) => {
        const block = topBlock(editor);
        if (!block) return;
        const raw = editor.markdown!.serialize({
          type: 'doc',
          content: [block.node.toJSON()],
        });
        editor.commands.insertContentAt(
          { from: block.from, to: block.from + block.node.nodeSize },
          {
            type: 'sourceBlock',
            attrs: {
              raw: `<div style="text-align:${direction}">\n\n${raw}\n\n</div>`,
            },
          },
        );
      },
      insertBlock: insertMarkdown,
      insertInline: (snippet) => {
        if (snippet === '[[') editor.chain().focus().insertContent('[[').run();
        else insertMarkdown(snippet);
      },
      replaceRange: (from, to, text) => {
        editor.chain().focus().insertContentAt({ from, to }, text).run();
      },
    };
    commandsRef.current = commands;
    if (live.current.visible) {
      live.current.richCommandsRef.current = commands;
      live.current.focusRef.current = () => editor.commands.focus();
      live.current.editorRef.current = null;
    }
    return () => {
      if (live.current.richCommandsRef.current === commands)
        live.current.richCommandsRef.current = null;
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Asynchronous uploads track their insertion bookmark through every edit.
  async function uploadAtSelection(file: File) {
    const editor = editorRef.current;
    if (!editor) return;
    let position = editor.state.selection.from;
    const original = source.current;
    const map = ({
      transaction,
    }: {
      transaction: import('@tiptap/pm/state').Transaction;
    }) => {
      position = transaction.mapping.map(position);
    };
    editor.on('transaction', map);
    try {
      const url = await live.current.uploadImage(file);
      if (url && !editor.isDestroyed && source.current === original) {
        editor.commands.insertContentAt(position, {
          type: 'image',
          attrs: { src: url, alt: file.name.replace(/\.[^.]+$/, '') },
        });
      }
    } finally {
      editor.off('transaction', map);
    }
  }

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      props.body === emitted.current ||
      (props.visible && isOurs(emissions.current, props.body))
    )
      return;
    source.current = new RichDocument();
    editor.commands.setContent(source.current.parse(editor, props.body), {
      emitUpdate: false,
    });
    // External document replacement must not leave undo pointing into another note.
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      }),
    );
    source.current.remember(editor, props.body);
    emitted.current = props.body;
    emissions.current = emissionsFrom(props.body);
    setSlash(null);
    setWiki(null);
    setHandle(null);
    setRawEdit(null);
    setLink(null);
  }, [props.body]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (props.visible) {
      props.richCommandsRef.current = commandsRef.current;
      props.focusRef.current = () => editor.commands.focus();
      props.editorRef.current = null;
    } else {
      props.richCommandsRef.current = null;
      setSlash(null);
      setWiki(null);
      setSelectionPoint(null);
      setHandle(null);
      setLink(null);
      setRawEdit(null);
      menu.close();
    }
  }, [props.visible]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = slash ?? wiki;
    if (current?.items.length) {
      editor.view.dom.setAttribute(
        'aria-controls',
        slash ? SLASH_MENU_ID : 'studio-wikimenu',
      );
      editor.view.dom.setAttribute(
        'aria-activedescendant',
        slash
          ? slashOptionId(current.index)
          : `studio-wiki-option-${current.index}`,
      );
    } else {
      editor.view.dom.removeAttribute('aria-controls');
      editor.view.dom.removeAttribute('aria-activedescendant');
    }
  }, [slash, wiki]);

  function dropDestination(editor: Editor, y: number) {
    let destination = editor.state.doc.content.size;
    editor.state.doc.forEach((_node, pos) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      if (
        y < rect.top + rect.height / 2 &&
        destination === editor.state.doc.content.size
      )
        destination = pos;
    });
    return destination;
  }

  function turnInto(target: TurnTarget) {
    const editor = editorRef.current;
    const from = menu.key;
    if (!editor || from === null) return;
    editor.commands.setTextSelection(from + 1);
    const commands = commandsRef.current!;
    if (target.type === 'heading')
      commands.heading((target.depth ?? 1) as 1 | 2 | 3);
    else if (target.type === 'list') commands.bulletList();
    else if (target.type === 'task') commands.taskList();
    else if (target.type === 'quote') commands.quote();
    else if (target.type === 'code') commands.codeBlock();
    else editor.chain().focus().clearNodes().setParagraph().run();
  }

  const editor = editorRef.current;
  const menuNode =
    editor && menu.key !== null ? editor.state.doc.nodeAt(menu.key) : null;
  const menuMarkdown = menuNode
    ? editor!.markdown!.serialize({ type: 'doc', content: [menuNode.toJSON()] })
    : '';
  const menuBlock = parseBlocks(menuMarkdown)[0] ?? null;
  const activeCommands = commandsRef.current;

  return (
    <div className="studio-rich-shell">
      <div
        className="studio-rich-scroll"
        ref={scroller}
        onScroll={() => refreshRef.current()}
      >
        <div
          className="studio-rich-page"
          onMouseMove={(event) => {
            if (menu.key !== null || dragFrom.current !== null || !editor)
              return;
            let element = event.target as HTMLElement;
            const root = editor.view.dom;
            while (element.parentElement && element.parentElement !== root)
              element = element.parentElement;
            if (element.parentElement === root) {
              editor.state.doc.forEach((_node, pos) => {
                if (editor.view.nodeDOM(pos) === element)
                  updateHandle(editor, pos);
              });
            }
          }}
          onDragOver={(event) => {
            if (dragFrom.current === null || !editor) return;
            event.preventDefault();
            const position = dropDestination(editor, event.clientY);
            const dom = editor.view.nodeDOM(position) as HTMLElement | null;
            const pane = scroller.current!;
            setDropLine(
              (dom?.getBoundingClientRect().top ??
                editor.view.dom.getBoundingClientRect().bottom) -
                pane.getBoundingClientRect().top +
                pane.scrollTop,
            );
            const rect = pane.getBoundingClientRect();
            if (event.clientY < rect.top + 60) pane.scrollTop -= 14;
            if (event.clientY > rect.bottom - 60) pane.scrollTop += 14;
          }}
        >
          <div ref={host} />
          {handle && (
            <div
              className="studio-rich-handle"
              style={{ top: `${handle.top}px` }}
            >
              <button
                type="button"
                aria-label="Add a block below"
                title="Add a block below"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!editor) return;
                  const node = editor.state.doc.nodeAt(handle.from);
                  if (!node) return;
                  const pos = handle.from + node.nodeSize;
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(pos, {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '/' }],
                    })
                    .setTextSelection(pos + 2)
                    .run();
                }}
              >
                +
              </button>
              <button
                type="button"
                draggable
                aria-label="Block actions"
                aria-haspopup="menu"
                title="Drag to reorder · click for actions · Alt+↑/↓ to move"
                onClick={(event) => {
                  if (suppressHandleClick.current) {
                    suppressHandleClick.current = false;
                    return;
                  }
                  if (!editor) return;
                  editor.commands.setNodeSelection(handle.from);
                  menu.toggleUnder(handle.from, event.currentTarget);
                }}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pointerDrag.current = {
                    from: handle.from,
                    y: event.clientY,
                    moved: false,
                  };
                  suppressHandleClick.current = false;
                }}
                onPointerMove={(event) => {
                  const drag = pointerDrag.current;
                  if (!drag || !editor) return;
                  if (!drag.moved && Math.abs(event.clientY - drag.y) < 5)
                    return;
                  drag.moved = true;
                  dragFrom.current = drag.from;
                  const position = dropDestination(editor, event.clientY);
                  const dom = editor.view.nodeDOM(
                    position,
                  ) as HTMLElement | null;
                  const pane = scroller.current!;
                  setDropLine(
                    (dom?.getBoundingClientRect().top ??
                      editor.view.dom.getBoundingClientRect().bottom) -
                      pane.getBoundingClientRect().top +
                      pane.scrollTop,
                  );
                  const bounds = pane.getBoundingClientRect();
                  if (event.clientY < bounds.top + 60) pane.scrollTop -= 18;
                  if (event.clientY > bounds.bottom - 60) pane.scrollTop += 18;
                }}
                onPointerUp={(event) => {
                  const drag = pointerDrag.current;
                  pointerDrag.current = null;
                  dragFrom.current = null;
                  setDropLine(null);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  if (!drag?.moved || !editor) return;
                  suppressHandleClick.current = true;
                  const node = editor.state.doc.nodeAt(drag.from);
                  const destination = dropDestination(editor, event.clientY);
                  const bounds = scroller.current!.getBoundingClientRect();
                  if (
                    !node ||
                    event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    (destination >= drag.from &&
                      destination <= drag.from + node.nodeSize)
                  )
                    return;
                  const target =
                    destination > drag.from
                      ? destination - node.nodeSize
                      : destination;
                  const tr = editor.state.tr
                    .delete(drag.from, drag.from + node.nodeSize)
                    .insert(target, node);
                  tr.setSelection(NodeSelection.create(tr.doc, target));
                  editor.view.dispatch(tr.scrollIntoView());
                  editor.view.focus();
                  updateHandle(editor, target);
                  props.onNotice('Block moved.');
                }}
                onPointerCancel={() => {
                  pointerDrag.current = null;
                  dragFrom.current = null;
                  setDropLine(null);
                }}
              >
                ⠿
              </button>
            </div>
          )}
          {dropLine !== null && (
            <div
              className="studio-rich-drop"
              style={{ top: `${dropLine}px` }}
            />
          )}
        </div>
        {props.uploading && (
          <p className="studio-vsurface__uploading" role="status">
            Uploading image…
          </p>
        )}
      </div>
      <StudioSlashMenu
        open={Boolean(slash)}
        items={slash?.items ?? []}
        grouped={!slash?.query}
        activeIndex={slash?.index ?? 0}
        position={slash?.point ?? null}
        onHover={(index) => slash && setSlash({ ...slash, index })}
        onChoose={choose}
      />
      {slash && !slash.items.length && (
        <div
          className="studio-rich-popover"
          style={{ top: slash.point.top, left: slash.point.left }}
          role="status"
        >
          No blocks match “{slash.query}”. Try “heading” or “list”.
        </div>
      )}
      <WikiLinkAutocomplete
        open={Boolean(wiki?.items.length)}
        items={wiki?.items ?? []}
        activeIndex={wiki?.index ?? 0}
        position={wiki?.point ?? null}
        onHover={(index) => wiki && setWiki({ ...wiki, index })}
        onChoose={chooseWiki}
      />
      {activeCommands && !rawEdit && (
        <StudioInlineToolbar
          position={slash || link ? null : selectionPoint}
          docked={props.compact && props.visible && !slash && !link}
          commands={activeCommands}
          activeMarks={
            new Set(
              ['bold', 'italic', 'strike', 'code', 'link'].filter((mark) =>
                editor?.isActive(mark),
              ),
            )
          }
        />
      )}
      <StudioBlockMenu
        block={menuBlock}
        menuRef={menu.ref}
        position={menu.position}
        onClose={menu.close}
        onTurnInto={turnInto}
        onMove={moveBlock}
        onDuplicate={() => {
          if (editor && menuNode && menu.key !== null)
            editor
              .chain()
              .focus()
              .insertContentAt(menu.key + menuNode.nodeSize, menuNode.toJSON())
              .run();
        }}
        onCopy={() => {
          void navigator.clipboard.writeText(menuMarkdown).then(
            () => props.onNotice('Block copied.'),
            () => props.onNotice('Could not access the clipboard.'),
          );
        }}
        onDelete={() => {
          if (editor && menuNode && menu.key !== null)
            editor
              .chain()
              .focus()
              .deleteRange({ from: menu.key, to: menu.key + menuNode.nodeSize })
              .run();
        }}
      />
      {editor?.isActive('table') && props.visible && (
        <div
          className="studio-table-tools"
          role="toolbar"
          aria-label="Table actions"
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            + Row
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            + Column
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            Delete row
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            Delete column
          </button>
        </div>
      )}
      {link && (
        <form
          className="studio-rich-popover studio-link-form"
          style={{ top: link.point.top, left: link.point.left }}
          role="dialog"
          aria-label="Edit link"
          onSubmit={(event) => {
            event.preventDefault();
            const url = link.url.trim();
            if (url && !/^(https?:\/\/|mailto:|\/|#)/i.test(url)) {
              setLinkError('Use an https:// URL, email link, or local path.');
              return;
            }
            if (!editor) return;
            const chain = editor
              .chain()
              .focus()
              .setTextSelection({ from: link.from, to: link.to });
            if (!url) chain.extendMarkRange('link').unsetLink().run();
            else if (link.from === link.to)
              chain
                .insertContent({
                  type: 'text',
                  text: url,
                  marks: [{ type: 'link', attrs: { href: url } }],
                })
                .run();
            else chain.setLink({ href: url }).run();
            setLink(null);
          }}
        >
          <label for="studio-link-url">Link destination</label>
          <input
            id="studio-link-url"
            autoFocus
            placeholder="https://example.com"
            value={link.url}
            onInput={(event) =>
              setLink({ ...link, url: event.currentTarget.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLink(null);
                editor?.commands.focus();
              }
            }}
          />
          {linkError && <p role="alert">{linkError}</p>}
          <div>
            <button
              type="button"
              onClick={() => {
                setLink(null);
                editor?.commands.focus();
              }}
            >
              Cancel
            </button>
            <button type="submit">Apply link</button>
          </div>
        </form>
      )}
      {rawEdit && (
        <div
          className="studio-source-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Edit custom Markdown"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setRawEdit(null);
              editor?.commands.focus();
            }
            if (event.key === 'Tab') {
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'textarea, button',
                ),
              );
              const index = controls.indexOf(
                document.activeElement as HTMLElement,
              );
              event.preventDefault();
              controls[
                (index + (event.shiftKey ? -1 : 1) + controls.length) %
                  controls.length
              ]?.focus();
            }
          }}
        >
          <div>
            <h2>Custom Markdown</h2>
            <p>Edit this block’s source.</p>
            <textarea
              aria-label="Custom Markdown source"
              autoFocus
              value={rawEdit.raw}
              onInput={(event) =>
                setRawEdit({ ...rawEdit, raw: event.currentTarget.value })
              }
            />
            <footer>
              <button
                type="button"
                onClick={() => {
                  setRawEdit(null);
                  editor?.commands.focus();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  editor
                    ?.chain()
                    .focus()
                    .setNodeSelection(rawEdit.from)
                    .updateAttributes('sourceBlock', { raw: rawEdit.raw })
                    .run();
                  setRawEdit(null);
                }}
              >
                Apply changes
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
