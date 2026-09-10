import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { imageSource } from './studioRichImage';

/** Editor-only controls. Only image attributes are persisted to Markdown. */
export function imageNodeView(
  { node: initial, editor, getPos }: NodeViewRendererProps,
  onActions: (node: Node, trigger: HTMLButtonElement) => void,
) {
  let node = initial;
  const dom = document.createElement('figure');
  dom.dataset.richImage = '';
  const img = document.createElement('img');
  img.draggable = false;
  const caption = document.createElement('figcaption');
  const below = document.createElement('button');
  below.type = 'button';
  below.dataset.writeBelowImage = '';
  below.setAttribute('aria-label', 'Write below image');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'studio-image-more';
  more.dataset.studioMenuTrigger = '';
  more.dataset.imageControl = '';
  more.setAttribute('aria-label', 'Image actions');
  more.setAttribute('aria-haspopup', 'menu');
  more.textContent = '···';
  more.onclick = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.commands.setNodeSelection(pos);
    onActions(node, more);
  };
  dom.append(img, caption, below, more);
  let cancel: (() => void) | null = null;
  const handles = [-1, 1].map((direction) => {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'studio-image-resize';
    handle.dataset.imageControl = '';
    handle.setAttribute(
      'aria-label',
      `Resize image from ${direction < 0 ? 'left' : 'right'}`,
    );
    handle.title = 'Drag to resize. Arrow keys adjust width.';
    handle.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      commit(
        Number(node.attrs.widthPercent) + (event.key === 'ArrowRight' ? 5 : -5),
      );
    };
    handle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancel?.();
      const start = event.clientX;
      const containerWidth = dom.getBoundingClientRect().width;
      if (!containerWidth) return;
      const initialWidth =
        (img.getBoundingClientRect().width / containerWidth) * 100;
      let width = initialWidth;
      handle.setPointerCapture(event.pointerId);
      dom.classList.add('is-resizing');
      const move = (next: PointerEvent) => {
        const multiplier = node.attrs.align === 'center' ? 2 : 1;
        width = Math.min(
          100,
          Math.max(
            10,
            initialWidth +
              ((direction * multiplier * (next.clientX - start)) /
                containerWidth) *
                100,
          ),
        );
        img.style.width = `${width}%`;
        position();
      };
      const finish = (save: boolean) => {
        cancel = null;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', abort);
        handle.removeEventListener('lostpointercapture', abort);
        window.removeEventListener('keydown', escape);
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
        dom.classList.remove('is-resizing');
        img.style.removeProperty('width');
        if (save) commit(width);
        render();
      };
      const up = () => finish(true);
      const abort = () => finish(false);
      const escape = (key: KeyboardEvent) => {
        if (key.key === 'Escape') {
          key.preventDefault();
          finish(false);
        }
      };
      cancel = abort;
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', abort);
      handle.addEventListener('lostpointercapture', abort);
      window.addEventListener('keydown', escape);
    };
    dom.append(handle);
    return handle;
  });
  function commit(value: number) {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    const widthPercent = Math.min(100, Math.max(10, Math.round(value / 5) * 5));
    if (widthPercent === node.attrs.widthPercent) return;
    editor.view.dispatch(
      closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
        ...node.attrs,
        widthPercent,
      }),
    );
    editor.view.dispatch(closeHistory(editor.state.tr));
  }
  function position() {
    const left = img.offsetLeft;
    const top = img.offsetTop;
    more.style.left = `${Math.max(left + 4, left + img.offsetWidth - 34)}px`;
    more.style.top = `${top + 6}px`;
    handles.forEach((handle, index) => {
      handle.style.left = `${left + (index ? img.offsetWidth : 0)}px`;
      handle.style.top = `${top + img.offsetHeight / 2}px`;
    });
  }
  function render() {
    const { src, alt, align, widthPercent, caption: text } = node.attrs;
    dom.className = `note-figure note-figure--align-${align === 'inline' ? 'left' : align}${dom.classList.contains('ProseMirror-selectednode') ? ' ProseMirror-selectednode' : ''}`;
    if (img.getAttribute('src') !== imageSource(src))
      img.setAttribute('src', imageSource(src));
    img.alt = alt ?? '';
    img.className = `note-image note-image--align-${align} note-image--width-${widthPercent}`;
    caption.textContent = text ?? '';
    caption.hidden = !text;
    position();
  }
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
  observer?.observe(img);
  observer?.observe(dom);
  render();
  return {
    dom,
    update(next: Node) {
      if (next.type !== node.type) return false;
      cancel?.();
      node = next;
      render();
      return true;
    },
    stopEvent(event: Event) {
      return (
        event.target instanceof Element &&
        !!event.target.closest('[data-image-control]')
      );
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      cancel?.();
      observer?.disconnect();
    },
  };
}
