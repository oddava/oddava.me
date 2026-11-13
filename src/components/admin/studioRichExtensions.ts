import type { Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { BlockSelectionExtension } from './studioBlockSelection';
import { Columns, Column } from './studioColumns';
import { RichImage } from './studioRichImage';
import { YoutubeVideo } from './studioYoutube';
import { StudioFind } from './studioFind';
import { SourceBlock, WikiLink } from './studioRichDocument';
import { StudioFocus } from './studioFocus';

interface ExtensionOptions {
  /** Read at render time, so a custom block always uses the current renderer. */
  renderMarkdown: (raw: string) => string;
  onImageActions: (node: PMNode, trigger: HTMLElement) => void;
}

/** The schema and behaviour of Studio's one continuous editing surface. */
export function studioRichExtensions({
  renderMarkdown,
  onImageActions,
}: ExtensionOptions): Extensions {
  return [
    StarterKit.configure({
      underline: false,
      trailingNode: false,
      link: { openOnClick: false },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    RichImage.configure({
      onActions: (node, trigger) => onImageActions(node, trigger),
    }),
    YoutubeVideo,
    BlockSelectionExtension,
    StudioFind,
    Columns,
    Column,
    TableKit,
    Markdown,
    SourceBlock.extend({
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement('div');
          dom.className = 'studio-custom-block';
          const content = document.createElement('div');
          content.contentEditable = 'false';
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.editSource = '';
          button.contentEditable = 'false';
          button.textContent = 'Edit custom block';
          dom.append(content, button);
          const render = (raw: string) => {
            content.innerHTML = renderMarkdown(raw);
            if (
              !content.textContent?.trim() &&
              !content.querySelector('img, iframe, video, audio, hr')
            )
              content.textContent = 'Custom block';
          };
          render(node.attrs.raw);
          return {
            dom,
            update(next) {
              if (next.type !== node.type) return false;
              node = next;
              render(next.attrs.raw);
              return true;
            },
          };
        };
      },
    }),
    WikiLink,
    StudioFocus,
    Placeholder.configure({
      placeholder: ({ node, pos }) =>
        node.type.name !== 'heading'
          ? 'Type / for blocks…'
          : // The page's first line is its title.
            pos === 0
            ? 'Untitled'
            : 'Heading',
    }),
  ];
}
