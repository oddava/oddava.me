import { useEffect, useRef, useState } from 'preact/hooks';
import { isEmojiIcon } from '../../lib/content/noteIcon';
import StudioEditorPopover from './StudioEditorPopover';

const EMOJIS = [
  '📄',
  '📝',
  '📚',
  '💡',
  '🌱',
  '🌿',
  '🌍',
  '🏠',
  '⭐',
  '❤️',
  '🎨',
  '🎵',
  '📷',
  '💻',
  '🛠️',
  '🚀',
  '🧠',
  '☕',
  '🔥',
  '✅',
  '📌',
  '🗂️',
  '🔬',
  '🎯',
];

export default function StudioIconPicker({
  icon,
  onChange,
  uploadImage,
  onClose,
}: {
  icon?: string;
  onChange: (icon: string | undefined) => void;
  uploadImage: (file: File) => Promise<string | null>;
  onClose: () => void;
}) {
  const [emoji, setEmoji] = useState(icon && isEmojiIcon(icon) ? icon : '');
  const [tab, setTab] = useState<'emoji' | 'upload'>(
    icon && !isEmojiIcon(icon) ? 'upload' : 'emoji',
  );
  const [uploading, setUploading] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  function choose(value: string | undefined) {
    onChange(value);
    onClose();
  }
  return (
    <StudioEditorPopover
      title="File icon"
      onClose={onClose}
      anchorSelector=".studio-note-icon"
      className="studio-icon-picker"
    >
      <div className="studio-icon-tabs" role="tablist" aria-label="Icon type">
        {(['emoji', 'upload'] as const).map((value) => (
          <button
            type="button"
            role="tab"
            id={`studio-icon-tab-${value}`}
            aria-controls={`studio-icon-panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            disabled={uploading}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'emoji'
                  : event.key === 'End'
                    ? 'upload'
                    : tab === 'emoji'
                      ? 'upload'
                      : 'emoji';
              setTab(next);
              document.getElementById(`studio-icon-tab-${next}`)?.focus();
            }}
          >
            {value === 'emoji' ? 'Emoji' : 'Upload'}
          </button>
        ))}
      </div>
      {tab === 'emoji' ? (
        <form
          id="studio-icon-panel-emoji"
          role="tabpanel"
          aria-labelledby="studio-icon-tab-emoji"
          onSubmit={(event) => {
            event.preventDefault();
            if (isEmojiIcon(emoji)) choose(emoji);
          }}
        >
          <div className="studio-icon-grid">
            {EMOJIS.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`Use ${value} as file icon`}
                aria-pressed={icon === value}
                onClick={() => choose(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <label for="studio-icon-emoji">Or paste your own emoji</label>
          <div className="studio-icon-custom">
            <input
              id="studio-icon-emoji"
              value={emoji}
              maxLength={64}
              placeholder="😊"
              onInput={(event) => setEmoji(event.currentTarget.value.trim())}
            />
            <button type="submit" disabled={!isEmojiIcon(emoji)}>
              Use emoji
            </button>
          </div>
        </form>
      ) : (
        <div
          id="studio-icon-panel-upload"
          role="tabpanel"
          aria-labelledby="studio-icon-tab-upload"
          className="studio-icon-upload"
        >
          <label className="studio-icon-upload__target">
            <span aria-hidden="true" className="studio-icon-upload__preview">
              {icon && !isEmojiIcon(icon) ? <img src={icon} alt="" /> : '↑'}
            </span>
            <strong>{uploading ? 'Uploading…' : 'Choose an image'}</strong>
            <span>PNG, JPEG, GIF or WebP · up to 5 MB</span>
            <input
              aria-label="Upload custom icon"
              type="file"
              disabled={uploading}
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setUploading(true);
                const url = await uploadImage(file);
                if (!mounted.current) return;
                setUploading(false);
                if (url) choose(url);
              }}
            />
          </label>
          {uploading && <p role="status">Uploading your icon…</p>}
        </div>
      )}
      {icon && (
        <footer>
          <button
            className="studio-icon-remove"
            type="button"
            disabled={uploading}
            onClick={() => choose(undefined)}
          >
            Remove icon
          </button>
        </footer>
      )}
    </StudioEditorPopover>
  );
}
