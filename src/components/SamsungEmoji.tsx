import { useState } from 'preact/hooks';
import { samsungEmojiUrl } from '../lib/content/samsungEmoji';

export default function SamsungEmoji({
  emoji,
  className,
}: {
  emoji: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const src = samsungEmojiUrl(emoji);
  return src && failed !== emoji ? (
    <img
      className={className}
      src={src}
      alt={emoji}
      aria-hidden="true"
      width="32"
      height="32"
      referrerPolicy="no-referrer"
      onError={() => setFailed(emoji)}
    />
  ) : (
    <span className={className} aria-hidden="true">
      {emoji}
    </span>
  );
}
