import type { DOMOutputSpec } from '@tiptap/pm/model';
import Image from '@tiptap/extension-image';
import {
  buildImageMarkup,
  type ImageMarkupOptions,
} from './studioEditorCommands';

export function imageSource(value: string): string {
  const source = value.trim();
  return /^(https?:\/\/|\/(?!\/))/i.test(source) ? source : '';
}

/** Read the image markup Studio has emitted, including older inline styles. */
export function parseImageMarkup(raw: string): ImageMarkupOptions | null {
  if (!/^\s*<(img|figure)\b/i.test(raw)) return null;
  const document = new DOMParser().parseFromString(raw, 'text/html');
  const root = document.body.firstElementChild;
  if (!root || document.body.children.length !== 1) return null;
  const img = root.matches('img') ? root : root.querySelector('img');
  if (!img || document.body.querySelectorAll('img').length !== 1) return null;
  if (root.querySelector('*:not(img):not(figcaption)')) return null;
  const src = imageSource(img.getAttribute('src') ?? '');
  if (!src) return null;
  const styles = `${img.getAttribute('style') ?? ''};${root.getAttribute('style') ?? ''}`;
  const classes = `${img.className} ${root.className}`;
  const align =
    /(?:align-|text-align\s*:\s*|float\s*:\s*)(left|center|right)/i.exec(
      classes + ' ' + styles,
    )?.[1] ??
    (/display\s*:\s*block.*margin[^;]*auto/i.test(styles)
      ? 'center'
      : 'inline');
  const width = /width-(\d+)|width\s*:\s*(\d+)%/i.exec(classes + ' ' + styles);
  return {
    src,
    alt: img.getAttribute('alt') ?? '',
    caption: root.querySelector('figcaption')?.textContent ?? '',
    align: align as ImageMarkupOptions['align'],
    widthPercent: width
      ? Math.min(100, Math.max(10, Number(width[1] ?? width[2])))
      : 100,
  };
}

export const RichImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: 'figure[data-rich-image]',
        getAttrs: (element) =>
          parseImageMarkup(
            element.outerHTML.replace(/<button[\s\S]*?<\/button>/g, ''),
          ) ?? false,
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => parseImageMarkup(element.outerHTML) ?? false,
      },
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: { default: '' },
      align: { default: 'inline' },
      widthPercent: { default: 100 },
    };
  },
  renderHTML({ node }): DOMOutputSpec {
    const { src, alt, caption, align, widthPercent } = node.attrs;
    const classes = ['note-image'];
    if (widthPercent < 100) classes.push(`note-image--width-${widthPercent}`);
    if (align !== 'inline') classes.push(`note-image--align-${align}`);
    const image: DOMOutputSpec = [
      'img',
      {
        src: imageSource(src),
        alt,
        class: classes.join(' '),
        draggable: 'false',
      },
    ];
    return [
      'figure',
      {
        class: `note-figure note-figure--align-${align === 'inline' ? 'left' : align}`,
        'data-rich-image': '',
      },
      image,
      ...(caption ? [['figcaption', {}, caption] as DOMOutputSpec] : []),
      [
        'button',
        {
          type: 'button',
          'data-write-below-image': '',
          contenteditable: 'false',
          'aria-label': 'Write below image',
        },
      ],
    ];
  },
  renderMarkdown: (node) => buildImageMarkup(node.attrs as ImageMarkupOptions),
});
