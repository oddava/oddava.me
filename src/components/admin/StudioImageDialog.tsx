import { useEffect, useState } from 'preact/hooks';
import { imageSource } from './studioRichImage';
import StudioEditorPopover from './StudioEditorPopover';
import {
  buildImageMarkup,
  type ImageMarkupOptions,
} from './studioEditorCommands';

interface StudioImageDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: ImageMarkupOptions;
  onSubmit: (markup: string) => void;
}
export interface ImageEditRequest {
  image: ImageMarkupOptions;
  onSubmit: (markup: string) => void;
}
export default function StudioImageDialog({
  open,
  onClose,
  initial,
  onSubmit,
}: StudioImageDialogProps) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (open) setSrc(initial?.src ?? '');
  }, [open, initial]);
  if (!open) return null;
  return (
    <StudioEditorPopover
      title={initial ? 'Replace image' : 'Insert image'}
      onClose={onClose}
    >
      <form
        className="studio-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!imageSource(src)) return;
          onSubmit(
            buildImageMarkup({
              alt: '',
              align: 'left',
              ...initial,
              src: imageSource(src),
            }),
          );
          onClose();
        }}
      >
        <label for="studio-image-url">Image link</label>
        <input
          id="studio-image-url"
          type="text"
          autoFocus
          value={src}
          placeholder="https://… or /images/…"
          onInput={(event) => setSrc(event.currentTarget.value)}
        />
        {src && !imageSource(src) && (
          <p role="status">Use an https:// URL or a path starting with /.</p>
        )}
        <div>
          <button type="submit" disabled={!imageSource(src)}>
            {initial ? 'Replace image' : 'Insert image'}
          </button>
        </div>
      </form>
    </StudioEditorPopover>
  );
}
