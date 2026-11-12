import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { youtubeEmbedUrl } from '../../lib/garden/youtube';
import StudioEditorPopover from './StudioEditorPopover';
import type { Point } from './studioRichGeometry';
import { isAllowedLinkUrl } from './studioRichCommands';

// The small forms the rich editor opens over its page. Their state lives in
// StudioRichEditor, because the editor's own handlers open and reset them.

export type YoutubeDraft = { url: string; from: number };
export type LinkDraft = { from: number; to: number; url: string; point: Point };
export type RawEditDraft = { from: number; raw: string };
export type ImageDetailDraft = {
  node: PMNode;
  field: 'caption' | 'alt';
  value: string;
};

export function StudioYoutubePopover({
  youtube,
  error,
  editor,
  setYoutube,
  setError,
}: {
  youtube: YoutubeDraft;
  error: string;
  editor: Editor | null;
  setYoutube: (next: YoutubeDraft | null) => void;
  setError: (next: string) => void;
}) {
  return (
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
            setError(
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
          id="studio-youtube-url"
          className="admin-input"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          value={youtube?.url ?? ''}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'studio-youtube-error' : undefined}
          onInput={(event) => {
            if (youtube)
              setYoutube({ ...youtube, url: event.currentTarget.value });
            setError('');
          }}
        />
        {error && (
          <p
            id="studio-youtube-error"
            className="studio-field-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="studio-form-actions">
          <button type="submit" className="studio-btn studio-btn--primary">
            Embed video
          </button>
        </div>
      </form>
    </StudioEditorPopover>
  );
}

export function StudioImageDetailPopover({
  detail,
  setDetail,
  onApply,
}: {
  detail: ImageDetailDraft;
  setDetail: (next: ImageDetailDraft | null) => void;
  onApply: (node: PMNode, attrs: Record<string, unknown>) => void;
}) {
  return (
    <StudioEditorPopover
      title={detail.field === 'caption' ? 'Image caption' : 'Image alt text'}
      onClose={() => setDetail(null)}
    >
      <form
        className="studio-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(detail.node, {
            [detail.field]: detail.value,
          });
          setDetail(null);
        }}
      >
        <label for="studio-image-detail">
          {detail.field === 'caption' ? 'Caption' : 'Alt text'}
        </label>
        <input
          id="studio-image-detail"
          autoFocus
          value={detail.value}
          placeholder={
            detail.field === 'caption'
              ? 'Add a caption…'
              : 'Describe the image for screen readers…'
          }
          onInput={(event) =>
            setDetail({
              ...detail,
              value: event.currentTarget.value,
            })
          }
        />
        <div className="studio-form-actions">
          <button type="submit" className="studio-btn studio-btn--primary">
            Save
          </button>
        </div>
      </form>
    </StudioEditorPopover>
  );
}

export function StudioLinkPopover({
  link,
  error,
  editor,
  setLink,
  setError,
}: {
  link: LinkDraft;
  error: string;
  editor: Editor | null;
  setLink: (next: LinkDraft | null) => void;
  setError: (next: string) => void;
}) {
  return (
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
          if (!isAllowedLinkUrl(url)) {
            setError('Use an https:// URL, email link, or local path.');
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
        {error && (
          <p className="studio-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="studio-form-actions">
          <button
            type="button"
            className="studio-btn"
            onClick={() => {
              setLink(null);
              editor?.commands.focus();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="studio-btn studio-btn--primary">
            Apply link
          </button>
        </div>
      </form>
    </StudioEditorPopover>
  );
}

export function StudioRawEditPopover({
  rawEdit,
  editor,
  setRawEdit,
}: {
  rawEdit: RawEditDraft;
  editor: Editor | null;
  setRawEdit: (next: RawEditDraft | null) => void;
}) {
  return (
    <StudioEditorPopover
      title="Edit custom Markdown"
      onClose={() => {
        setRawEdit(null);
        editor?.commands.focus();
      }}
    >
      <div className="studio-editor-form">
        <p className="studio-field-help">
          This block is kept as written. Edit its Markdown directly.
        </p>
        <textarea
          aria-label="Custom Markdown source"
          autoFocus
          value={rawEdit.raw}
          onInput={(event) =>
            setRawEdit({ ...rawEdit, raw: event.currentTarget.value })
          }
        />
        <div className="studio-form-actions">
          <button
            type="button"
            className="studio-btn"
            onClick={() => {
              setRawEdit(null);
              editor?.commands.focus();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--primary"
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
        </div>
      </div>
    </StudioEditorPopover>
  );
}
