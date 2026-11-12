import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { BlockSelection } from './studioBlockSelection';
import { useStudioBlockMarquee } from './useStudioBlockMarquee';
import { useStudioBlockHandle } from './useStudioBlockHandle';
import {
  useStudioRichSuggestions,
  useSuggestionAria,
} from './useStudioRichSuggestions';
import type { ImageEditRequest } from './StudioImageDialog';
import StudioSlashMenu from './StudioSlashMenu';
import StudioInlineToolbar from './StudioInlineToolbar';
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
  uploading: boolean;
  compact: boolean;
  visible: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: (request?: ImageEditRequest) => void;
  onNotice: (message: string) => void;
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

  function refresh() {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || !live.current.visible) return;
    const { selection } = editor.state;
    const { from, to, empty } = selection;
    blocks.syncHandle(editor);
    const matched = suggestions.update(editor, live.current.suggestions);
    if (!empty && selection instanceof TextSelection && editor.isFocused)
      setSelectionPoint(toolbarPoint(editor, from, to));
    else setSelectionPoint(null);
    editor.view.dom.setAttribute('aria-expanded', String(matched));
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
    const target = wikiTarget(item);
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

    const commands = createEditorCommands(editor, { showLink, insertMarkdown });
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
    blocks.hideHandle();
    setRawEdit(null);
    setYoutube(null);
    setLink(null);
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

  function turnInto(target: TurnTarget) {
    const editor = editorRef.current;
    const from = menu.key;
    if (!editor || from === null) return;
    editor.commands.setTextSelection(from + 1);
    const commands = commandsRef.current!;
    if (target.type === 'heading')
      commands.heading((target.depth ?? 1) as 1 | 2 | 3 | 4 | 5 | 6);
    else if (target.type === 'list') commands.bulletList();
    else if (target.type === 'task') commands.taskList();
    else if (target.type === 'quote') commands.quote();
    else if (target.type === 'code') commands.codeBlock();
    else editor.chain().focus().clearNodes().setParagraph().run();
  }

  const editor = editorRef.current;
  const activeCommands = commandsRef.current;

  return (
    <div className="studio-rich-shell">
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
          // The bar above draws its rule only once the page has slid under it.
          event.currentTarget
            .closest('.studio-editor')
            ?.classList.toggle(
              'is-scrolled',
              event.currentTarget.scrollTop > 0,
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
