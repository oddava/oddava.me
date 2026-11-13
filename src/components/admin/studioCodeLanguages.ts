import {
  CODE_LANGUAGES,
  fenceLanguage,
  isPlainFence,
  resolveCodeLanguage,
} from '../../lib/garden/code-languages';
import type { PickerOption } from './studioPicker';

// What the code block's language picker lists and how a choice becomes the
// fence's language. Pure, so the rules are testable without an editor.

const PLAIN_ID = 'plain';

/**
 * The list for a block whose fence currently says `info`: plain text, then the
 * catalogue. A language outside the catalogue that the block already uses is
 * kept in the list, so reopening the picker never loses it.
 */
export function codeLanguageOptions(
  info: string | null | undefined,
): PickerOption[] {
  const options: PickerOption[] = [
    { id: PLAIN_ID, label: 'Plain text', keywords: 'text none txt' },
    ...CODE_LANGUAGES.map((language) => ({
      id: language.id,
      label: language.label,
      hint: language.id,
      keywords: language.aliases.join(' '),
    })),
  ];
  const word = fenceLanguage(info);
  if (!isPlainFence(info) && !resolveCodeLanguage(word))
    options.splice(1, 0, { id: word, label: word, hint: 'custom' });
  return options;
}

/** Which row is in effect for `info`: the catalogued id, the author's own word, or plain. */
export function currentCodeLanguage(info: string | null | undefined): string {
  if (isPlainFence(info)) return PLAIN_ID;
  return resolveCodeLanguage(info)?.id ?? fenceLanguage(info);
}

/**
 * Offered when what was typed names no listed language. Fence words are
 * single tokens, so anything that could not be one is not offered.
 */
export function customLanguageOption(query: string): PickerOption | null {
  const word = query.trim().toLowerCase();
  if (!/^[\w+#.-]{1,24}$/.test(word)) return null;
  return {
    id: word,
    label: `Use “${word}”`,
    hint: 'custom',
  };
}

/** The fence language a picked row writes; none for plain text. */
export function languageFromPick(id: string): string | null {
  return id === PLAIN_ID ? null : id;
}
