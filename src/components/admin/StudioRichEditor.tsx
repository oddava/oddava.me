import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { TagCount } from '../../lib/garden/connections';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { BlockSelection } from './studioBlockSelection';
import { carrySelection } from './studioCarrySelection';
import { useStudioBlockMarquee } from './useStudioBlockMarquee';
import { useStudioBlockHandle } from './useStudioBlockHandle';
import {
  useStudioRichSuggestions,
  useSuggestionAria,
} from './useStudioRichSuggestions';
import type { ImageEditRequest } from './StudioImageDialog';
import StudioSlashMenu from './StudioSlashMenu';
import StudioInlineToolbar, {
  focusFormattingToolbar,
} from './StudioInlineToolbar';
import StudioKeyboardBar from './StudioKeyboardBar';
import StudioOutline from './StudioOutlinePanel';
import StudioFindBar from './StudioFindBar';
import StudioWordCount from './StudioWordCounter';
import { useStudioNavigate } from './useStudioNavigate';
import StudioBlockHandle from './StudioBlockHandle';
import StudioRichBlockMenu from './StudioRichBlockMenu';
import StudioImageMenu from './StudioImageMenu';
import StudioTableTools from './StudioTableTools';
import {
  StudioImageDetailPopover,
  StudioLinkPopover,
  StudioRawEditPopover,
  StudioYoutubePopover,
  type ImageDetailDraft,
  type LinkDraft,
  type RawEditDraft,
  type YoutubeDraft,
} from './StudioRichPopovers';
import WikiLinkAutocomplete from './WikiLinkAutocomplete';
import { useStudioMenu } from './useStudioMenu';
import type { TurnTarget } from './studioBlocks';
import { RichDocument } from './studioRichDocument';
import type { EditorCommands } from './studioEditorCommands';
import type { WikiSuggestion } from './WikiLinkAutocomplete';
import { emissionsFrom, isOurs, remember } from './studioEmissions';
import { studioRichExtensions } from './studioRichExtensions';
import { richKeyDown, type RichKeymapContext } from './studioRichKeymap';
import { richClickOn, richFileDrop, richPaste } from './studioRichInput';
import {
  changeImageNode,
  createEditorCommands,
  insertMarkdownInto,
  moveSelectedBlocks,
  moveTopBlock,
  requestImageEdit,
  slashActions,
  uploadImageAtSelection,
} from './studioRichCommands';
import {
  pointAt,
  sideDropStyle,
  toolbarPoint,
  topBlock,
  type Point,
} from './studioRichGeometry';
import { wikiTarget } from './studioRichSuggestions';
import NotePageIcon from '../NotePageIcon';

interface Props {
  icon?: string;
  body: string;
  renderMarkdown: (raw: string) => string;
  commandsRef: MutableRef<EditorCommands | null>;
  focusRef: MutableRef<(() => void) | null>;
  suggestions: WikiSuggestion[];
  /** Every tag in use, for the # autocomplete. */
  tags: TagCount[];
  /** Rendered under the page, inside the same scroll. */
  footer?: ComponentChildren;
  uploading: boolean;
  compact: boolean;
  /** A phone's on-screen keyboard is up: the writing tools ride above it. */
  keyboardOpen?: boolean;
  visible: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: (request?: ImageEditRequest) => void;
  onNotice: (message: string) => void;
}

/** Whether the selection's block already is what `target` would make. */
function isBlockType(editor: Editor, target: TurnTarget): boolean {
  switch (target.type) {
    case 'heading':
      return editor.isActive('heading', { level: target.depth ?? 1 });
    case 'list':
      return editor.isActive(target.ordered ? 'orderedList' : 'bulletList');
    case 'task':
      return editor.isActive('taskList');
    case 'quote':
      return editor.isActive('blockquote');
    case 'code':
      return editor.isActive('codeBlock');
    case 'paragraph':
      return (
        editor.isActive('paragraph') &&
        !editor.isActive('bulletList') &&
        !editor.isActive('orderedList') &&
        !editor.isActive('taskList') &&
        !editor.isActive('blockquote')
      );
    default:
      return false;
  }
}

/** The selection's block, named as the Formatting bar's Turn into names it. */
function currentBlockType(editor: Editor): string {
  for (const level of [1, 2, 3, 4, 5, 6])
    if (editor.isActive('heading', { level })) return `Heading ${level}`;
  if (editor.isActive('taskList')) return 'To-do list';
  if (editor.isActive('orderedList')) return 'Numbered list';
  if (editor.isActive('bulletList')) return 'Bulleted list';
  if (editor.isActive('callout')) return 'Callout';
  if (editor.isActive('blockquote')) return 'Quote';
  if (editor.isActive('codeBlock')) return 'Code';
  return 'Text';
}

/** One continuous editing surface: the DOM and its selection belong to ProseMirror. */
export default function StudioRichEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const marquee = useStudioBlockMarquee(editorRef, scroller);
  const live = useRef(props);
  live.current = props;
  const source = useRef(new RichDocument());
  const emitted = useRef(props.body);
  const emissions = useRef(emissionsFrom(props.body));
  const suggestions = useStudioRichSuggestions();
  const { slash, setSlash, wiki, setWiki, slashRef, wikiRef } = suggestions;
  const [selectionPoint, setSelectionPoint] = useState<Point | null>(null);
  // Bumped on each refresh while the phone's writing tools are up, so their
  // enabled and pressed states follow the caret.
  const [, setTick] = useState(0);
  /**
   * Where the phone's + put a "/" of its own, so a menu dismissed without a
   * choice takes that line away again instead of leaving a stray slash.
   */
  const barSlash = useRef<{
    from: number;
    ownLine: boolean;
    /** Where the caret was before the press, to go back to. */
    caret: number;
  } | null>(null);
  const menu = useStudioMenu<number>();
  const imageMenu = useStudioMenu<PMNode>();
  const imageMenuRef = useRef(imageMenu);
  imageMenuRef.current = imageMenu;
  // Called after both menus, where its Escape listener effect always sat.
  const blocks = useStudioBlockHandle(scroller, live);
  const { handle, setHandle, sideDrop, dropLine, updateHandle, deleteBlockAt } =
    blocks;
  const [imageDetail, setImageDetail] = useState<ImageDetailDraft | null>(null);
  const [link, setLink] = useState<LinkDraft | null>(null);
  const [linkError, setLinkError] = useState('');
  const [youtube, setYoutube] = useState<YoutubeDraft | null>(null);
  const [youtubeError, setYoutubeError] = useState('');
  const [rawEdit, setRawEdit] = useState<RawEditDraft | null>(null);
  const commandsRef = useRef<EditorCommands | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const chooseRef = useRef<(index: number) => void>(() => {});
  const chooseWikiRef = useRef<(index: number) => void>(() => {});
  const moveRef = useRef<(direction: -1 | 1) => void>(() => {});
  // The palette and the bar reach the navigation panels through the commands,
  // which are built once; this is how those see the current render's.
  const navRef = useRef<ReturnType<typeof useStudioNavigate>>(null!);

  function refresh() {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || !live.current.visible) return;
    const { selection } = editor.state;
    const { from, to, empty } = selection;
    blocks.syncHandle(editor);
    const matched = suggestions.update(
      editor,
      live.current.suggestions,
      live.current.tags,
    );
    const inBar = Boolean(
      document.activeElement?.closest?.('.studio-inline-toolbar'),
    );
    if (
      !empty &&
      selection instanceof TextSelection &&
      (editor.isFocused || inBar)
    )
      setSelectionPoint(toolbarPoint(editor, from, to));
    else setSelectionPoint(null);
    editor.view.dom.setAttribute('aria-expanded', String(matched));
    if (live.current.compact && live.current.keyboardOpen)
      setTick((tick) => tick + 1);
  }
  refreshRef.current = refresh;

  /**
   * Keep the caret's line in view when the page under it gets shorter — the
   * phone's slash panel opening, or the keyboard bar arriving.
   */
  function keepCaretVisible() {
    const editor = editorRef.current;
    const pane = scroller.current;
    if (!editor || editor.isDestroyed || !pane || !editor.isFocused) return;
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    const box = pane.getBoundingClientRect();
    if (caret.bottom > box.bottom - 16)
      pane.scrollTop += caret.bottom - box.bottom + 32;
    else if (caret.top < box.top + 8)
      pane.scrollTop -= box.top - caret.top + 32;
  }

  useEffect(() => {
    const pane = scroller.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      refreshRef.current();
      if (live.current.compact) keepCaretVisible();
    });
    observer.observe(pane);
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  function insertMarkdown(markdown: string) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    insertMarkdownInto(editor, source.current, markdown);
  }

  const imageTap = useRef({ pos: -1, time: 0 });
  function changeImage(node: PMNode, attrs: Record<string, unknown> | null) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    changeImageNode(editor, node, attrs, (message) =>
      live.current.onNotice(message),
    );
  }
  function editImage(node: PMNode) {
    const editor = editorRef.current;
    if (!editor) return;
    requestImageEdit(editor, node, source, {
      onRequestImage: (request) => live.current.onRequestImage(request),
      onNotice: (message) => live.current.onNotice(message),
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
    const actions = slashActions(editor, commandsRef.current!, {
      requestImage: () => live.current.onRequestImage(),
      embedYoutube: () => {
        setYoutubeError('');
        setYoutube({ url: '', from: editor.state.selection.from });
      },
      showLink,
    });
    actions[item.id]?.();
  }
  chooseRef.current = choose;

  function chooseWiki(index: number) {
    const editor = editorRef.current;
    const current = wikiRef.current;
    const item = current?.items[index];
    if (!editor || !current || !item) return;
    // A tag stays the plain text the garden index reads; only a note is a node.
    const content =
      current.kind === 'tag'
        ? { type: 'text', text: item.insert }
        : {
            type: 'wikiLink',
            attrs: { target: wikiTarget(item), label: item.title },
          };
    editor
      .chain()
      .focus()
      .insertContentAt({ from: current.from, to: current.to }, content)
      .run();
    setWiki(null);
  }
  chooseWikiRef.current = chooseWiki;

  function moveBlock(direction: -1 | 1) {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.state.selection instanceof BlockSelection) {
      moveSelectedBlocks(editor, editor.state.selection, direction);
      return;
    }
    const target = moveTopBlock(
      editor,
      menu.key ?? editor.state.selection.from,
      direction,
    );
    if (target === null) return;
    updateHandle(editor, target);
    live.current.onNotice(
      direction < 0 ? 'Block moved up.' : 'Block moved down.',
    );
  }
  moveRef.current = moveBlock;

  // Asynchronous uploads track their insertion bookmark through every edit.
  async function uploadAtSelection(file: File) {
    const editor = editorRef.current;
    if (!editor) return;
    await uploadImageAtSelection(editor, source, file, (image) =>
      live.current.uploadImage(image),
    );
  }

  useEffect(() => {
    if (!host.current) return;
    // The editor is built once. Everything its handlers reach is a ref, a
    // state setter, or a function from this first render that only reads refs.
    const keymap: RichKeymapContext = {
      slashRef,
      wikiRef,
      dismissed: suggestions.dismissed,
      setSlash,
      setWiki,
      chooseRef,
      chooseWikiRef,
      moveRef,
      cancelBlockDrag: blocks.cancelEditorDrag,
      clearHandle: () => setHandle(null),
      deleteBlockAt,
      showLink,
      save: () => live.current.onSave(),
    };
    const upload = (file: File) => void uploadAtSelection(file);
    const editor: Editor = new Editor({
      element: host.current,
      extensions: studioRichExtensions({
        renderMarkdown: (raw) => live.current.renderMarkdown(raw),
        onImageActions: (node, trigger) =>
          imageMenuRef.current.toggleUnder(node, trigger),
      }),
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
        handleKeyDown: (_view, event) => richKeyDown(editor, event, keymap),
        handlePaste: (_view, event) =>
          richPaste(editor, event, { upload, insertMarkdown }),
        handleDOMEvents: {
          dragend: () => blocks.endNativeDrag(),
          dragstart: (view, event) => blocks.beginNativeDrag(view, event),
        },
        handleDrop: (_view, event) =>
          blocks.dropNativeBlock(editor, event) ||
          richFileDrop(editor, _view, event, upload),
        handleDoubleClickOn: (_view, _pos, node) => {
          if (node.type.name !== 'image') return false;
          editImage(node);
          return true;
        },
        handleClickOn: (_view, _pos, node, nodePos, event) =>
          richClickOn(editor, node, nodePos, event, {
            suggestions: () => live.current.suggestions,
            editImage,
            imageTap,
            editSource: (from, raw) => setRawEdit({ from, raw }),
          }),
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
      onBlur: ({ event }) => {
        // Focus stepping into the Formatting bar (Alt+F10) keeps it up.
        const next = (event as FocusEvent).relatedTarget as Element | null;
        if (next?.closest?.('.studio-inline-toolbar')) return;
        setSelectionPoint(null);
      },
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
      ...createEditorCommands(editor, { showLink, insertMarkdown }),
      outline: () => navRef.current.toggleOutline(),
      find: () => navRef.current.openFind(),
    };
    commandsRef.current = commands;
    if (live.current.visible) {
      live.current.commandsRef.current = commands;
      live.current.focusRef.current = () => editor.commands.focus();
    }
    return () => {
      if (live.current.commandsRef.current === commands)
        live.current.commandsRef.current = null;
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (
      !editor ||
      props.body === emitted.current ||
      isOurs(emissions.current, props.body)
    )
      return;
    // The pane is keyed by note, so this is the same note replaced from
    // outside: keep the caret and the scroll where they were (see
    // `carrySelection`) rather than sending both to the top.
    const { anchor, head } = editor.state.selection;
    const scrollTop = scroller.current?.scrollTop ?? 0;
    source.current = new RichDocument();
    editor.commands.setContent(source.current.parse(editor, props.body), {
      emitUpdate: false,
    });
    // External document replacement must not leave undo pointing into another note.
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
        selection: carrySelection(editor.state.doc, { anchor, head }),
      }),
    );
    if (scroller.current) scroller.current.scrollTop = scrollTop;
    source.current.remember(editor, props.body);
    emitted.current = props.body;
    emissions.current = emissionsFrom(props.body);
    setSlash(null);
    setWiki(null);
    blocks.hideHandle();
    setRawEdit(null);
    setYoutube(null);
    setLink(null);
    nav.close();
  }, [props.body]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (props.visible) {
      props.commandsRef.current = commandsRef.current;
      props.focusRef.current = () => editor.commands.focus();
    } else {
      props.commandsRef.current = null;
      setSlash(null);
      setWiki(null);
      setSelectionPoint(null);
      blocks.hideHandle();
      setLink(null);
      setRawEdit(null);
      setYoutube(null);
      menu.close();
    }
  }, [props.visible]);

  useSuggestionAria(editorRef, slash, wiki);
  // After the effect that builds the editor, so it finds the editor built.
  const nav = useStudioNavigate(editorRef, props.visible);
  navRef.current = nav;

  useEffect(() => {
    scroller.current
      ?.closest('.studio-editor')
      ?.classList.remove('is-scrolled', 'is-past-title');
  }, []);

  useEffect(() => {
    if (slash) return;
    const placed = barSlash.current;
    barSlash.current = null;
    const editor = editorRef.current;
    if (!placed || !editor || editor.isDestroyed) return;
    const node = editor.state.doc.nodeAt(placed.from);
    if (node?.type.name !== 'paragraph' || node.textContent !== '/') return;
    const { head } = editor.state.selection;
    const onLine = head > placed.from && head < placed.from + node.nodeSize;
    const tr = placed.ownLine
      ? editor.state.tr.delete(placed.from, placed.from + node.nodeSize)
      : editor.state.tr.delete(placed.from + 1, placed.from + 2);
    if (onLine) {
      const caret = Math.min(tr.mapping.map(placed.caret), tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1));
    }
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  }, [slash]);

  /** The phone's +: the block menu at the caret, or away again. */
  function toggleBarSlash() {
    const editor = editorRef.current;
    if (!editor) return;
    if (slash) {
      // Closing is dismissing: the effect above tidies up after the button.
      suggestions.dismissed.current = slash.from;
      setSlash(null);
      editor.commands.focus();
      return;
    }
    const { $from, empty } = editor.state.selection;
    const parent = $from.parent;
    // An empty line becomes the menu; anywhere else the menu opens on a new
    // line under the current block, the way the desktop's + does.
    if (empty && parent.type.name === 'paragraph' && !parent.content.size) {
      const from = $from.before();
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setMeta('addToHistory', false);
          return true;
        })
        .insertContent('/')
        .run();
      barSlash.current = { from, ownLine: false, caret: from + 1 };
      return;
    }
    const block = topBlock(editor);
    if (!block) return;
    const pos = block.from + block.node.nodeSize;
    const caret = editor.state.selection.head;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setMeta('addToHistory', false);
        return true;
      })
      .insertContentAt(pos, {
        type: 'paragraph',
        content: [{ type: 'text', text: '/' }],
      })
      .setTextSelection(pos + 2)
      .run();
    barSlash.current = { from: pos, ownLine: true, caret };
  }

  /**
   * Turn a block into another kind: the block menu's block (at `menu.key`),
   * or — from the Formatting bar — the blocks the selection is in.
   */
  function turnInto(target: TurnTarget, fromSelection = false) {
    const editor = editorRef.current;
    const from = menu.key;
    if (!editor || (!fromSelection && from === null)) return;
    if (!fromSelection) editor.commands.setTextSelection(from! + 1);
    if (isBlockType(editor, target)) {
      editor.commands.focus();
      return;
    }
    const commands = commandsRef.current!;
    if (target.type === 'heading')
      commands.heading((target.depth ?? 1) as 1 | 2 | 3 | 4 | 5 | 6);
    else if (target.type === 'list' && target.ordered) commands.orderedList();
    else if (target.type === 'list') commands.bulletList();
    else if (target.type === 'task') commands.taskList();
    else if (target.type === 'quote') commands.quote();
    else if (target.type === 'code') commands.codeBlock();
    else editor.chain().focus().clearNodes().setParagraph().run();
  }

  const editor = editorRef.current;
  const activeCommands = commandsRef.current;

  return (
    <div className="studio-rich-shell" onKeyDown={nav.onKeyDown}>
      {youtube && (
        <StudioYoutubePopover
          youtube={youtube}
          error={youtubeError}
          editor={editor}
          setYoutube={setYoutube}
          setError={setYoutubeError}
        />
      )}
      <div
        className="studio-rich-scroll"
        ref={scroller}
        // Shift+F10 or the Menu key: the block menu for the caret's block,
        // the keyboard's way to the grip a mouse finds by hovering.
        onKeyDown={(event) => {
          // Alt+F10: into the Formatting bar, the toolbar pattern's way in.
          if (event.altKey && event.key === 'F10' && selectionPoint) {
            if (focusFormattingToolbar()) event.preventDefault();
            return;
          }
          if (
            !editor ||
            !(
              event.key === 'ContextMenu' ||
              (event.shiftKey && event.key === 'F10')
            )
          )
            return;
          const block = topBlock(editor);
          const dom = block
            ? (editor.view.nodeDOM(block.from) as HTMLElement | null)
            : null;
          if (!block || !dom) return;
          event.preventDefault();
          const rect = dom.getBoundingClientRect();
          menu.openAtPoint(
            block.from,
            { x: rect.left, y: Math.min(rect.bottom, rect.top + 32) + 4 },
            editor.view.dom as HTMLElement,
          );
        }}
        onPointerDown={marquee.down}
        onPointerMove={marquee.move}
        onPointerUp={marquee.up}
        onPointerCancel={marquee.cancel}
        onMouseLeave={() =>
          blocks.paneMouseLeave(props.compact || menu.key !== null)
        }
        onMouseMove={(event) =>
          blocks.paneMouseMove(
            event,
            editor,
            props.compact || menu.key !== null,
          )
        }
        onScroll={(event) => {
          // The bar above draws its rule only once the page has slid under it,
          // and (on a phone) takes the note's name once its first block —
          // usually the title — has gone under it.
          const pane = event.currentTarget;
          const frame = pane.closest('.studio-editor');
          frame?.classList.toggle('is-scrolled', pane.scrollTop > 0);
          const first = host.current?.querySelector('.studio-rich-content > *');
          frame?.classList.toggle(
            'is-past-title',
            first
              ? first.getBoundingClientRect().bottom <
                  pane.getBoundingClientRect().top + 8
              : pane.scrollTop > 80,
          );
          blocks.paneScroll(props.compact || menu.key !== null);
          refreshRef.current();
        }}
        onDragOver={(event) => blocks.paneDragOver(event, editor)}
        onDrop={(event) => blocks.paneDrop(event, editor)}
      >
        <div className="studio-rich-page">
          <NotePageIcon icon={props.icon} />
          <div ref={host} />
          {marquee.box && (
            <div
              className="studio-block-marquee"
              style={marquee.box}
              aria-hidden="true"
            />
          )}
          {handle && (
            <StudioBlockHandle
              handle={handle}
              editor={editor}
              menu={menu}
              controls={blocks}
            />
          )}
          {sideDrop && scroller.current && (
            <div
              className="studio-rich-side-drop"
              aria-hidden="true"
              style={sideDropStyle(sideDrop, scroller.current)}
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
        {props.footer}
      </div>
      {props.visible &&
        nav.editor &&
        !(props.compact && props.keyboardOpen) && (
          <StudioWordCount editor={nav.editor} />
        )}
      {nav.editor && nav.panel === 'outline' && (
        <StudioOutline
          editor={nav.editor}
          compact={props.compact}
          onClose={nav.close}
          onFind={nav.openFind}
        />
      )}
      <StudioSlashMenu
        open={Boolean(slash)}
        items={slash?.items ?? []}
        grouped={!slash?.query}
        activeIndex={slash?.index ?? 0}
        position={slash?.point ?? null}
        docked={props.compact}
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
        kind={wiki?.kind}
        items={wiki?.items ?? []}
        activeIndex={wiki?.index ?? 0}
        position={wiki?.point ?? null}
        docked={props.compact}
        onHover={(index) => wiki && setWiki({ ...wiki, index })}
        onChoose={chooseWiki}
      />
      {props.visible && activeCommands && !rawEdit && (
        <StudioInlineToolbar
          position={slash || link ? null : selectionPoint}
          docked={props.compact && Boolean(selectionPoint) && !slash && !link}
          keyboardOpen={props.keyboardOpen}
          commands={activeCommands}
          blockType={editor ? currentBlockType(editor) : undefined}
          onTurnInto={(target) => turnInto(target, true)}
          onDismiss={() => setSelectionPoint(null)}
          activeMarks={
            new Set(
              ['bold', 'italic', 'strike', 'code', 'link'].filter((mark) =>
                editor?.isActive(mark),
              ),
            )
          }
        />
      )}
      {nav.editor && nav.panel === 'find' && (
        <StudioFindBar
          editor={nav.editor}
          seed={nav.seed}
          docked={props.compact}
          onClose={nav.close}
        />
      )}
      {props.visible &&
        editor &&
        props.compact &&
        props.keyboardOpen &&
        !selectionPoint &&
        !link &&
        !rawEdit && (
          <StudioKeyboardBar
            editor={editor}
            slashOpen={Boolean(slash)}
            onInsert={toggleBarSlash}
            onLink={() => editor.chain().focus().insertContent('[[').run()}
          />
        )}
      <StudioRichBlockMenu
        editor={editor}
        menu={menu}
        onTurnInto={turnInto}
        onMove={moveBlock}
        deleteBlockAt={deleteBlockAt}
        onNotice={props.onNotice}
      />
      {editor?.isActive('table') && props.visible && (
        <StudioTableTools editor={editor} />
      )}
      <StudioImageMenu
        menu={imageMenu}
        onReplace={editImage}
        onDetail={setImageDetail}
        onChange={changeImage}
      />
      {imageDetail && (
        <StudioImageDetailPopover
          detail={imageDetail}
          setDetail={setImageDetail}
          onApply={changeImage}
        />
      )}
      {link && (
        <StudioLinkPopover
          link={link}
          error={linkError}
          editor={editor}
          setLink={setLink}
          setError={setLinkError}
        />
      )}
      {rawEdit && (
        <StudioRawEditPopover
          rawEdit={rawEdit}
          editor={editor}
          setRawEdit={setRawEdit}
        />
      )}
    </div>
  );
}
