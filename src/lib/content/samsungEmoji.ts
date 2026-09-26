import filenames from './samsungEmoji.json';

// Samsung One UI 8.5 artwork, pinned to the collection documented in docs/samsung-emoji.md.
const baseUrl =
  'https://cdn.jsdelivr.net/gh/RealityRipple/oneui-emoji@d587ab50481ff2fd2cd48d27ced7489d2b2ecf6c/png/112/';
const normalize = (sequence: string) =>
  sequence
    .split('-')
    .filter((point) => point !== 'fe0f')
    .join('-');
const images = new Map(filenames.map((name) => [normalize(name), name]));

export function samsungEmojiUrl(emoji: string): string | undefined {
  const sequence = [...emoji]
    .map((character) => character.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('-');
  const filename = images.get(normalize(sequence));
  return filename ? `${baseUrl}${filename}.png` : undefined;
}
