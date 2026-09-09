import { Node } from '@tiptap/core';
import { youtubeEmbedUrl, youtubeMarkup } from '../../lib/garden/youtube';

export function parseYoutubeMarkup(raw: string): { src: string } | null {
  if (!/^\s*<div class="note-youtube">/.test(raw)) return null;
  const document = new DOMParser().parseFromString(raw, 'text/html');
  const wrapper = document.body.firstElementChild;
  const frame = wrapper?.firstElementChild;
  if (
    document.body.children.length !== 1 ||
    wrapper?.children.length !== 1 ||
    frame?.tagName !== 'IFRAME'
  )
    return null;
  const src = youtubeEmbedUrl(frame.getAttribute('src') ?? '');
  return src ? { src } : null;
}

export const YoutubeVideo = Node.create({
  name: 'youtubeVideo',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: '' } }),
  parseHTML: () => [
    {
      tag: 'div.note-youtube',
      getAttrs: (element) => parseYoutubeMarkup(element.outerHTML) ?? false,
    },
  ],
  renderHTML: ({ node }) => [
    'div',
    { class: 'note-youtube', contenteditable: 'false' },
    [
      'iframe',
      {
        src: youtubeEmbedUrl(node.attrs.src) ?? '',
        title: 'YouTube video',
        loading: 'lazy',
        referrerpolicy: 'strict-origin-when-cross-origin',
        allow:
          'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen',
        allowfullscreen: '',
      },
    ],
  ],
  renderMarkdown: (node) => youtubeMarkup(node.attrs?.src ?? ''),
});
