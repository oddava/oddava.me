import { isEmojiIcon, isImageIcon } from '../../lib/content/noteIcon';
import SamsungEmoji from '../SamsungEmoji';
// Shared note glyphs for the desktop tree, mobile browser, and editor bar.

export function FileIcon({ icon }: { icon?: string }) {
  if (icon && isImageIcon(icon))
    return <img className="studio-file-icon" src={icon} alt="" />;
  if (icon && isEmojiIcon(icon))
    return <SamsungEmoji className="studio-file-icon" emoji={icon} />;
  return (
    <svg className="studio-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.25 3.25h5.5l4 4v9.5H5.25z" />
      <path d="M10.75 3.25v4h4M7.75 10.5h4.5M7.75 13.25h4.5" />
    </svg>
  );
}
