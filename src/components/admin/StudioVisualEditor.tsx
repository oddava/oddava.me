import {
  BlockSelection,
  BlockSelectionExtension,
  duplicateSelectedBlocks,
} from './studioBlockSelection';
import { useStudioBlockMarquee } from './useStudioBlockMarquee';
import {
  findSideDrop,
  moveBeside,
  moveBlocksTo,
  removeBlock,
  type SideDrop,
} from './studioSideDrop';
import { Columns, Column, makeColumns, activeColumns } from './studioColumns';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { Editor } from '@tiptap/core';
import { Slice, Fragment } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { RichImage } from './studioRichImage';
import { YoutubeVideo } from './studioYoutube';
import { youtubeEmbedUrl } from '../../lib/garden/youtube';
import StudioEditorPopover from './StudioEditorPopover';
import type { ImageEditRequest } from './StudioImageDialog';
import type { ImageMarkupOptions } from './studioEditorCommands';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import {
  EditorState,
  Selection,
  NodeSelection,
  TextSelection,
} from '@tiptap/pm/state';
import StudioSlashMenu, {
  SLASH_MENU_ID,
  slashOptionId,
} from './StudioSlashMenu';
import StudioInlineToolbar from './StudioInlineToolbar';
import StudioBlockMenu from './StudioBlockMenu';
import StudioContextMenu from './StudioContextMenu';
import WikiLinkAutocomplete from './WikiLinkAutocomplete';
import { useStudioMenu } from './useStudioMenu';
import {
  matchSlashCommands,
  parseBlocks,
  type SlashCommand,
  type TurnTarget,
} from './studioBlocks';
import { RichDocument, SourceBlock, WikiLink } from './studioRichDocument';
import { fuzzyScore } from './studioSearch';
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
  onRequestImage: (request?: ImageEditRequest) => void;
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
  let depth = 1;
  for (let d = 1; d <= $pos.depth; d++)
    if ($pos.node(d).type.name === 'column') depth = d + 1;
  const from = $pos.depth >= depth ? $pos.before(depth) : $pos.pos;
  const node = editor.state.doc.nodeAt(from);
  return node ? { from, node } : null;
}

/** One continuous editing surface: the DOM and its selection belong to ProseMirror. */
export default function StudioVisualEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const marquee = useStudioBlockMarquee(editorRef, scroller);
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
  const [handle, setHandle] = useState<{
    from: number;
    top: number;
    left: number;
    column: boolean;
  } | null>(null);
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const hoveredBlock = useRef<HTMLElement | null>(null);
  const dragFrom = useRef<number | null>(null);
  const nativeDragFrom = useRef<number | null>(null);
  const nativeDragSources = useRef<number[]>([]);
  const [sideDrop, setSideDrop] = useState<SideDrop | null>(null);
  const pointerDrag = useRef<{
    from: number;
    sources: number[];
    y: number;
    x: number;
    moved: boolean;
  } | null>(null);
  const suppressHandleClick = useRef(false);
  const [dropLine, setDropLine] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const menu = useStudioMenu<number>();
  const imageMenu = useStudioMenu<import('@tiptap/pm/model').Node>();
  const imageMenuRef = useRef(imageMenu);
  imageMenuRef.current = imageMenu;
  const [imageDetail, setImageDetail] = useState<{
    node: import('@tiptap/pm/model').Node;
    field: 'caption' | 'alt';
    value: string;
  } | null>(null);
  const [link, setLink] = useState<{
    from: number;
    to: number;
    url: string;
    point: Point;
  } | null>(null);
  const [linkError, setLinkError] = useState('');
  const [youtube, setYoutube] = useState<{ url: string; from: number } | null>(
    null,
  );
  const [youtubeError, setYoutubeError] = useState('');
  const youtubeInput = useRef<HTMLInputElement>(null);
  const [rawEdit, setRawEdit] = useState<{ from: number; raw: string } | null>(
    null,
  );
  const commandsRef = useRef<EditorCommands | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const chooseRef = useRef<(index: number) => void>(() => {});
  const chooseWikiRef = useRef<(index: number) => void>(() => {});
  const moveRef = useRef<(direction: -1 | 1) => void>(() => {});

  useEffect(() => {
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pointerDrag.current) return;
      pointerDrag.current = null;
      dragFrom.current = null;
      setSideDrop(null);
      setDropLine(null);
      suppressHandleClick.current = true;
    };
    window.addEventListener('keydown', cancelDrag);
    return () => window.removeEventListener('keydown', cancelDrag);
  }, []);

  function updateHandle(editor: Editor, from: number) {
    const dom = editor.view.nodeDOM(from) as HTMLElement | null;
    const pane = scroller.current;
    if (!dom || !pane) {
      setHandle(null);
      return;
    }
    hoveredBlock.current = dom;
    const column = dom.parentElement?.matches('[data-note-column]') ?? false;
    setHandle({
      from,
      column,
      left:
        dom.getBoundingClientRect().left -
        pane.getBoundingClientRect().left +
        pane.scrollLeft -
        (live.current.compact || column ? 44 : 76),
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
    } else if (hoveredBlock.current) {
      const dom = hoveredBlock.current;
      if (editor.view.dom.contains(dom)) {
        const block = topBlock(editor, editor.view.posAtDOM(dom, 0));
        if (block) updateHandle(editor, block.from);
        else setHandle(null);
      } else {
        hoveredBlock.current = null;
        setHandle(null);
      }
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

  useEffect(() => {
    const pane = scroller.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => refreshRef.current());
    observer.observe(pane);
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  function insertMarkdown(markdown: string) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const content = source.current.parse(editor, markdown).content ?? [];
    if (editor.state.selection instanceof BlockSelection) {
      editor.view.dispatch(
        editor.state.tr
          .replaceSelection(
            new Slice(
              Fragment.from(
                content.map((node) => editor.schema.nodeFromJSON(node)),
              ),
              0,
              0,
            ),
          )
          .scrollIntoView(),
      );
      editor.view.focus();
    } else editor.chain().focus().insertContent(content).run();
  }

  const imageTap = useRef({ pos: -1, time: 0 });
  function changeImage(
    node: import('@tiptap/pm/model').Node,
    attrs: Record<string, unknown> | null,
  ) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    let position: number | null = null;
    editor.state.doc.descendants((candidate, pos) => {
      if (candidate === node) position = pos;
    });
    if (position === null) {
      live.current.onNotice('This image is no longer in the document.');
      return;
    }
    if (attrs)
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          ...attrs,
        }),
      );
    else
      editor.commands.deleteRange({
        from: position,
        to: position + node.nodeSize,
      });
    editor.commands.focus();
  }
  function editImage(node: import('@tiptap/pm/model').Node) {
    const editor = editorRef.current;
    if (!editor) return;
    live.current.onRequestImage({
      image: node.attrs as ImageMarkupOptions,
      onSubmit: (markup) => {
        if (editor.isDestroyed) return;
        let position: number | null = null;
        editor.state.doc.descendants((candidate, pos) => {
          if (candidate === node) position = pos;
        });
        if (position === null) {
          live.current.onNotice('This image is no longer in the document.');
          return;
        }
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: position, to: position + node.nodeSize },
            source.current.parse(editor, markup).content ?? [],
          )
          .run();
      },
    });
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
      youtube: () => {
        setYoutubeError('');
        setYoutube({ url: '', from: editor.state.selection.from });
      },
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
    if (editor.state.selection instanceof BlockSelection) {
      const positions = editor.state.selection.positions;
      const first = positions[0]!;
      const last = positions.at(-1)!;
      const end = last + editor.state.doc.nodeAt(last)!.nodeSize;
      const neighbor =
        direction < 0
          ? editor.state.doc.resolve(first).nodeBefore
          : editor.state.doc.nodeAt(end);
      if (neighbor)
        moveBlocksTo(
          editor,
          positions,
          direction < 0 ? first - neighbor.nodeSize : end + neighbor.nodeSize,
        );
      return;
    }
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
        RichImage.configure({
          onActions: (node, trigger) =>
            imageMenuRef.current.toggleUnder(node, trigger),
        }),
        YoutubeVideo,
        BlockSelectionExtension,
        Columns,
        Column,
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
          if (
            event.key === 'Escape' &&
            (pointerDrag.current || nativeDragFrom.current !== null)
          ) {
            pointerDrag.current = null;
            dragFrom.current = null;
            nativeDragFrom.current = null;
            setSideDrop(null);
            setDropLine(null);
            suppressHandleClick.current = true;
            return true;
          }
          if (editor.state.selection instanceof BlockSelection) {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === 'd'
            ) {
              event.preventDefault();
              event.stopPropagation();
              duplicateSelectedBlocks(editor);
              return true;
            }
            if (event.key === 'Escape') {
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  Selection.near(
                    editor.state.doc.resolve(editor.state.selection.from),
                  ),
                ),
              );
              return true;
            }
            if (event.key === 'Backspace' || event.key === 'Delete') {
              event.preventDefault();
              editor.view.dispatch(
                editor.state.tr.deleteSelection().scrollIntoView(),
              );
              setHandle(null);
              return true;
            }
          }
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
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === 'a'
          ) {
            event.preventDefault();
            event.stopPropagation();
            const { $from } = editor.state.selection;
            if ($from.parent.isTextblock) {
              editor.commands.setTextSelection({
                from: $from.start(),
                to: $from.end(),
              });
            } else {
              const block = topBlock(editor);
              if (block) editor.commands.setNodeSelection(block.from);
            }
            return true;
          }
          if (
            !mod &&
            (event.key === 'Backspace' || event.key === 'Delete') &&
            editor.state.selection instanceof NodeSelection
          ) {
            event.preventDefault();
            deleteBlockAt(editor, editor.state.selection.from);
            return true;
          }
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
            if (event.key === 'Backspace') deleteBlockAt(editor, block.from);
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
        handleDOMEvents: {
          dragend: () => {
            nativeDragFrom.current = null;
            setSideDrop(null);
            setDropLine(null);
            return false;
          },
          dragstart: (view, event) => {
            const figure = (event.target as HTMLElement).closest(
              '[data-rich-image]',
            );
            if (figure) {
              const pos = view.posAtDOM(figure, 0);
              const $pos = view.state.doc.resolve(pos);
              const from =
                view.state.doc.nodeAt(pos)?.type.name === 'image'
                  ? pos
                  : $pos.before();
              if (!(
                view.state.selection instanceof BlockSelection &&
                view.state.selection.positions.includes(from)
              ))
                view.dispatch(
                  view.state.tr.setSelection(
                    NodeSelection.create(view.state.doc, from),
                  ),
                );
            }
            nativeDragSources.current =
              view.state.selection instanceof BlockSelection
                ? view.state.selection.positions
                : view.state.selection instanceof NodeSelection
                  ? [view.state.selection.from]
                  : [];
            nativeDragFrom.current = nativeDragSources.current[0] ?? null;
            return false;
          },
        },
        handleDrop: (_view, event) => {
          const nativeFrom = nativeDragFrom.current;
          nativeDragFrom.current = null;
          setSideDrop(null);
          setDropLine(null);
          if (nativeFrom !== null && !event.altKey && !event.ctrlKey) {
            event.preventDefault();
            applyBlockDrop(
              editor,
              nativeFrom,
              event.clientX,
              event.clientY,
              nativeDragSources.current,
            );
            return true;
          }
          // Preserve native text-selection drags and explicit copy modifiers.
          if (_view.dragging) return false;
          const hit = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
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
        handleDoubleClickOn: (_view, _pos, node) => {
          if (node.type.name !== 'image') return false;
          editImage(node);
          return true;
        },
        handleClickOn: (_view, _pos, node, nodePos, event) => {
          if (node.type.name === 'image') {
            if (
              (event.target as HTMLElement).closest('[data-write-below-image]')
            ) {
              const after = nodePos + node.nodeSize;
              const next = editor.state.doc.nodeAt(after);
              const chain = editor.chain();
              if (!next?.isTextblock)
                chain.insertContentAt(after, { type: 'paragraph' });
              chain
                .setTextSelection(after + 1)
                .focus()
                .run();
              imageTap.current = { pos: -1, time: 0 };
              return true;
            }
            const now = Date.now();
            if (
              imageTap.current.pos === nodePos &&
              now - imageTap.current.time < 350
            ) {
              imageTap.current = { pos: -1, time: 0 };
              editImage(node);
              return true;
            }
            imageTap.current = { pos: nodePos, time: now };
            return false;
          }
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
    hoveredBlock.current = null;
    setHandle(null);
    setRawEdit(null);
    setYoutube(null);
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
      hoveredBlock.current = null;
      setHandle(null);
      setLink(null);
      setRawEdit(null);
      setYoutube(null);
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

  function dropDestination(editor: Editor, y: number, x?: number) {
    const column =
      x === undefined
        ? null
        : document.elementFromPoint(x, y)?.closest('[data-note-column]');
    let parent = editor.state.doc;
    let start = 0;
    const rowRect = column?.parentElement?.getBoundingClientRect();
    if (column && rowRect && y > rowRect.top + 12 && y < rowRect.bottom - 12) {
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'column' &&
          editor.view.nodeDOM(pos) === column
        ) {
          parent = node;
          start = pos + 1;
        }
      });
    }
    let destination = start + parent.content.size;
    parent.forEach((_node, offset) => {
      const pos = start + offset;
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      if (
        y < rect.top + rect.height / 2 &&
        destination === start + parent.content.size
      )
        destination = pos;
    });
    return destination;
  }

  function dropMarker(editor: Editor, position: number) {
    const pane = scroller.current!;
    const $pos = editor.state.doc.resolve(position);
    const parent =
      $pos.parent.type.name === 'column'
        ? (editor.view.nodeDOM($pos.before()) as HTMLElement)
        : editor.view.dom;
    const rect = parent.getBoundingClientRect();
    const next = editor.view.nodeDOM(position) as HTMLElement | null;
    const bounds = pane.getBoundingClientRect();
    return {
      top:
        (next?.getBoundingClientRect().top ?? rect.bottom) -
        bounds.top +
        pane.scrollTop,
      left: rect.left - bounds.left + pane.scrollLeft,
      width: rect.width,
    };
  }

  function applyBlockDrop(
    editor: Editor,
    from: number,
    x: number,
    y: number,
    sources = [from],
  ) {
    const bounds = scroller.current!.getBoundingClientRect();
    setDropLine(null);
    setSideDrop(null);
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return;
    const snap = findSideDrop(editor, from, x, y, sources);
    if (snap) moveBeside(editor, from, snap.from, snap.side, sources);
    else moveBlocksTo(editor, sources, dropDestination(editor, y, x));
    setHandle(null);
  }

  function deleteBlockAt(editor: Editor, from: number) {
    removeBlock(editor, from);
    setHandle(null);
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
      {youtube && (
        <StudioEditorPopover
          title="Embed YouTube video"
          onClose={() => {
            setYoutube(null);
            editor?.commands.focus();
          }}
        >
          <form
            className="studio-youtube-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!youtube || !editor) return;
              const src = youtubeEmbedUrl(youtube.url);
              if (!src) {
                setYoutubeError(
                  'Enter a valid YouTube video link (watch, share, Shorts, or live).',
                );
                return;
              }
              editor
                .chain()
                .focus()
                .setTextSelection(youtube.from)
                .insertContent([
                  { type: 'youtubeVideo', attrs: { src } },
                  { type: 'paragraph' },
                ])
                .run();
              setYoutube(null);
            }}
          >
            <label for="studio-youtube-url">YouTube link</label>
            <input
              ref={youtubeInput}
              id="studio-youtube-url"
              className="admin-input"
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=…"
              value={youtube?.url ?? ''}
              aria-invalid={Boolean(youtubeError)}
              aria-describedby={
                youtubeError ? 'studio-youtube-error' : undefined
              }
              onInput={(event) => {
                if (youtube)
                  setYoutube({ ...youtube, url: event.currentTarget.value });
                setYoutubeError('');
              }}
            />
            {youtubeError && (
              <p id="studio-youtube-error" role="alert">
                {youtubeError}
              </p>
            )}
            <div>
              <button type="submit">Embed video</button>
            </div>
          </form>
        </StudioEditorPopover>
      )}
      <div
        className="studio-rich-scroll"
        ref={scroller}
        onPointerDown={marquee.down}
        onPointerMove={marquee.move}
        onPointerUp={marquee.up}
        onPointerCancel={marquee.cancel}
        onMouseLeave={() => {
          if (props.compact || menu.key !== null || pointerDrag.current) return;
          hoveredBlock.current = null;
          setHandle(null);
        }}
        onMouseMove={(event) => {
          if (
            props.compact ||
            menu.key !== null ||
            pointerDrag.current ||
            !editor
          )
            return;
          const target = event.target as HTMLElement;
          if (target.closest('.studio-rich-handle')) return;
          let element = target;
          const root = editor.view.dom;
          if (root.contains(element) && element !== root) {
            while (
              element.parentElement &&
              element.parentElement !== root &&
              !element.parentElement.matches('[data-note-column]')
            )
              element = element.parentElement;
            const block = topBlock(editor, editor.view.posAtDOM(element, 0));
            if (block) {
              updateHandle(editor, block.from);
              return;
            }
          }
          // Keep the gutter reachable while moving from text to its buttons.
          const rect = hoveredBlock.current?.getBoundingClientRect();
          if (
            rect &&
            handle &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom &&
            event.clientX >= rect.left - 76 &&
            event.clientX <= rect.right
          )
            return;
          hoveredBlock.current = null;
          setHandle(null);
        }}
        onScroll={() => {
          if (!props.compact && menu.key === null && !pointerDrag.current) {
            hoveredBlock.current = null;
            setHandle(null);
          }
          refreshRef.current();
        }}
        onDragOver={(event) => {
          const from = dragFrom.current ?? nativeDragFrom.current;
          if (from === null || !editor) return;
          event.preventDefault();
          const snap =
            !event.altKey && !event.ctrlKey
              ? findSideDrop(
                  editor,
                  from,
                  event.clientX,
                  event.clientY,
                  nativeDragSources.current.length
                    ? nativeDragSources.current
                    : [from],
                )
              : null;
          setSideDrop(snap);
          if (snap) {
            setDropLine(null);
            return;
          }
          const position = dropDestination(
            editor,
            event.clientY,
            event.clientX,
          );
          const pane = scroller.current!;
          setDropLine(dropMarker(editor, position));
          const rect = pane.getBoundingClientRect();
          if (event.clientY < rect.top + 60) pane.scrollTop -= 14;
          if (event.clientY > rect.bottom - 60) pane.scrollTop += 14;
        }}
        onDrop={(event) => {
          const from = nativeDragFrom.current;
          if (from === null || !editor) return;
          event.preventDefault();
          nativeDragFrom.current = null;
          applyBlockDrop(
            editor,
            from,
            event.clientX,
            event.clientY,
            nativeDragSources.current,
          );
        }}
      >
        <div className="studio-rich-page">
          <div ref={host} />
          {marquee.box && (
            <div
              className="studio-block-marquee"
              style={marquee.box}
              aria-hidden="true"
            />
          )}
          {handle && (
            <div
              className={`studio-rich-handle${handle.column ? ' is-column' : ''}`}
              style={{ top: `${handle.top}px`, left: `${handle.left}px` }}
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
                title="Drag to move or place beside a block · click for actions"
                onClick={(event) => {
                  if (suppressHandleClick.current) {
                    suppressHandleClick.current = false;
                    return;
                  }
                  if (!editor) return;
                  if (!(
                    editor.state.selection instanceof BlockSelection &&
                    editor.state.selection.positions.includes(handle.from)
                  ))
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
                    sources:
                      editor?.state.selection instanceof BlockSelection &&
                      editor.state.selection.positions.includes(handle.from)
                        ? editor.state.selection.positions
                        : [handle.from],
                    y: event.clientY,
                    x: event.clientX,
                    moved: false,
                  };
                  suppressHandleClick.current = false;
                }}
                onPointerMove={(event) => {
                  const drag = pointerDrag.current;
                  if (!drag || !editor) return;
                  if (
                    !drag.moved &&
                    Math.hypot(event.clientY - drag.y, event.clientX - drag.x) <
                      5
                  )
                    return;
                  drag.moved = true;
                  dragFrom.current = drag.from;
                  const snap = findSideDrop(
                    editor,
                    drag.from,
                    event.clientX,
                    event.clientY,
                    drag.sources,
                  );
                  setSideDrop(snap);
                  if (snap) {
                    setDropLine(null);
                    return;
                  }
                  const position = dropDestination(
                    editor,
                    event.clientY,
                    event.clientX,
                  );
                  const pane = scroller.current!;
                  setDropLine(dropMarker(editor, position));
                  const bounds = pane.getBoundingClientRect();
                  if (event.clientY < bounds.top + 60) pane.scrollTop -= 18;
                  if (event.clientY > bounds.bottom - 60) pane.scrollTop += 18;
                }}
                onPointerUp={(event) => {
                  const drag = pointerDrag.current;
                  pointerDrag.current = null;
                  dragFrom.current = null;
                  setDropLine(null);
                  setSideDrop(null);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  if (!drag?.moved || !editor) return;
                  suppressHandleClick.current = true;
                  applyBlockDrop(
                    editor,
                    drag.from,
                    event.clientX,
                    event.clientY,
                    drag.sources,
                  );
                }}
                onPointerCancel={() => {
                  pointerDrag.current = null;
                  dragFrom.current = null;
                  setDropLine(null);
                  setSideDrop(null);
                }}
              >
                <svg
                  width="16"
                  height="20"
                  viewBox="0 0 16 20"
                  aria-hidden="true"
                  fill="currentColor"
                >
                  {[5, 10, 15].map((y) => (
                    <g key={y}>
                      <circle cx="5" cy={y} r="1.5" />
                      <circle cx="11" cy={y} r="1.5" />
                    </g>
                  ))}
                </svg>
              </button>
            </div>
          )}
          {sideDrop && scroller.current && (
            <div
              className="studio-rich-side-drop"
              aria-hidden="true"
              style={{
                top:
                  sideDrop.rect.top -
                  scroller.current.getBoundingClientRect().top +
                  scroller.current.scrollTop,
                left:
                  (sideDrop.side === 'left'
                    ? sideDrop.rect.left
                    : sideDrop.rect.right) -
                  scroller.current.getBoundingClientRect().left +
                  scroller.current.scrollLeft -
                  2,
                height: sideDrop.rect.height,
              }}
            />
          )}
          {dropLine !== null && (
            <div className="studio-rich-drop" style={dropLine} />
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
      {props.visible && activeCommands && !rawEdit && (
        <StudioInlineToolbar
          position={slash || link ? null : selectionPoint}
          docked={props.compact && Boolean(selectionPoint) && !slash && !link}
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
        columnLayout={
          editor ? activeColumns(editor)?.node.attrs.layout : undefined
        }
        onColumnLayout={
          editor && activeColumns(editor)?.node.childCount === 2
            ? (layout) => {
                const row = activeColumns(editor)!;
                editor.view.dispatch(
                  editor.state.tr.setNodeMarkup(row.from, undefined, {
                    layout,
                  }),
                );
                editor.view.focus();
              }
            : undefined
        }
        onStack={
          editor && activeColumns(editor)
            ? () => {
                const row = activeColumns(editor)!;
                const blocks: import('@tiptap/pm/model').Node[] = [];
                row.node.forEach((column) =>
                  column.forEach((block) => {
                    blocks.push(block);
                  }),
                );
                editor.view.dispatch(
                  editor.state.tr.replaceWith(
                    row.from,
                    row.from + row.node.nodeSize,
                    blocks,
                  ),
                );
                editor.view.focus();
              }
            : undefined
        }
        onColumns={
          editor && !activeColumns(editor)
            ? (count) => {
                if (menu.key !== null) makeColumns(editor, menu.key, count);
              }
            : undefined
        }
        onAddColumn={
          editor && activeColumns(editor)?.node.childCount === 2
            ? () => {
                const row = activeColumns(editor)!;
                editor.view.dispatch(
                  editor.state.tr
                    .insert(
                      row.from + row.node.nodeSize - 1,
                      editor.schema.nodes.column!.createAndFill()!,
                    )
                    .setNodeMarkup(row.from, undefined, { layout: 'three' }),
                );
                editor.view.focus();
              }
            : undefined
        }
        onMove={moveBlock}
        onDuplicate={() => {
          if (editor?.state.selection instanceof BlockSelection) {
            duplicateSelectedBlocks(editor);
            return;
          }
          if (editor && menuNode && menu.key !== null)
            editor
              .chain()
              .focus()
              .insertContentAt(menu.key + menuNode.nodeSize, menuNode.toJSON())
              .run();
        }}
        onCopy={() => {
          const selection = editor?.state.selection;
          const markdown =
            selection instanceof BlockSelection
              ? editor!.markdown!.serialize({
                  type: 'doc',
                  content: selection.positions.map((pos) =>
                    editor!.state.doc.nodeAt(pos)!.toJSON(),
                  ),
                })
              : menuMarkdown;
          void navigator.clipboard.writeText(markdown).then(
            () => props.onNotice('Block copied.'),
            () => props.onNotice('Could not access the clipboard.'),
          );
        }}
        onDelete={() => {
          if (editor?.state.selection instanceof BlockSelection)
            editor.view.dispatch(
              editor.state.tr.deleteSelection().scrollIntoView(),
            );
          else if (editor && menuNode && menu.key !== null)
            deleteBlockAt(editor, menu.key);
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
      <StudioContextMenu
        open={imageMenu.key !== null}
        label="Image actions"
        menuRef={imageMenu.ref}
        position={imageMenu.position}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            const node = imageMenu.key;
            imageMenu.close();
            if (node) editImage(node);
          }}
        >
          Replace image
        </button>
        {(['caption', 'alt'] as const).map((field) => (
          <button
            type="button"
            role="menuitem"
            key={field}
            onClick={() => {
              const node = imageMenu.key;
              imageMenu.close();
              if (node)
                setImageDetail({ node, field, value: node.attrs[field] ?? '' });
            }}
          >
            {field === 'caption' ? 'Caption' : 'Alt text'}
          </button>
        ))}
        <div
          className="studio-image-align"
          role="group"
          aria-label="Image alignment"
        >
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={
                (imageMenu.key?.attrs.align === 'inline'
                  ? 'left'
                  : imageMenu.key?.attrs.align) === align
              }
              onClick={() => {
                const node = imageMenu.key;
                imageMenu.close();
                if (node) changeImage(node, { align });
              }}
            >
              {align.charAt(0).toUpperCase() + align.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            const node = imageMenu.key;
            imageMenu.close();
            if (node) changeImage(node, { widthPercent: 100 });
          }}
        >
          Full width
        </button>
        <div className="studio-menu-separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="is-danger"
          onClick={() => {
            const node = imageMenu.key;
            imageMenu.close();
            if (node) changeImage(node, null);
          }}
        >
          Delete image
        </button>
      </StudioContextMenu>
      {imageDetail && (
        <StudioEditorPopover
          title={
            imageDetail.field === 'caption' ? 'Image caption' : 'Image alt text'
          }
          onClose={() => setImageDetail(null)}
        >
          <form
            className="studio-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              changeImage(imageDetail.node, {
                [imageDetail.field]: imageDetail.value,
              });
              setImageDetail(null);
            }}
          >
            <label for="studio-image-detail">
              {imageDetail.field === 'caption' ? 'Caption' : 'Alt text'}
            </label>
            <input
              id="studio-image-detail"
              autoFocus
              value={imageDetail.value}
              placeholder={
                imageDetail.field === 'caption'
                  ? 'Add a caption…'
                  : 'Describe the image for screen readers…'
              }
              onInput={(event) =>
                setImageDetail({
                  ...imageDetail,
                  value: event.currentTarget.value,
                })
              }
            />
            <div>
              <button type="submit">Save</button>
            </div>
          </form>
        </StudioEditorPopover>
      )}
      {link && (
        <StudioEditorPopover
          title="Edit link"
          onClose={() => {
            setLink(null);
            editor?.commands.focus();
          }}
        >
          <form
            className="studio-editor-form"
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
        </StudioEditorPopover>
      )}
      {rawEdit && (
        <StudioEditorPopover
          title="Edit custom Markdown"
          onClose={() => {
            setRawEdit(null);
            editor?.commands.focus();
          }}
        >
          <div>
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
        </StudioEditorPopover>
      )}
    </div>
  );
}
