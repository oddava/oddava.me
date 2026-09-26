import { isEmojiIcon, isImageIcon } from '../lib/content/noteIcon';
import SamsungEmoji from './SamsungEmoji';

export default function NotePageIcon({ icon }: { icon?: string }) {
  if (!icon) return null;
  const className = 'note-page-icon';
  if (isImageIcon(icon))
    return <img className={className} src={icon} alt="" draggable={false} />;
  return isEmojiIcon(icon) ? (
    <SamsungEmoji className={className} emoji={icon} />
  ) : null;
}
