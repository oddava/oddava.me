// The languages a note's code blocks can name, shared by the public renderer
// (which highlights them) and Studio (which offers them in the block's picker).
// `id` is what gets written after the fence, so it is the spelling authors
// already use most: ```ts, ```bash, ```python.

export interface CodeLanguage {
  id: string;
  label: string;
  /** Other fence spellings that mean the same language. */
  aliases: readonly string[];
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'js', label: 'JavaScript', aliases: ['javascript', 'mjs', 'cjs'] },
  { id: 'ts', label: 'TypeScript', aliases: ['typescript', 'mts', 'cts'] },
  { id: 'jsx', label: 'JSX', aliases: [] },
  { id: 'tsx', label: 'TSX', aliases: [] },
  { id: 'json', label: 'JSON', aliases: ['jsonc', 'json5'] },
  { id: 'html', label: 'HTML', aliases: ['xml', 'svg', 'astro', 'vue'] },
  { id: 'css', label: 'CSS', aliases: ['scss', 'less'] },
  {
    id: 'bash',
    label: 'Shell',
    aliases: ['sh', 'shell', 'zsh', 'console', 'terminal'],
  },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'hpp'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'sql', label: 'SQL', aliases: ['postgres', 'mysql', 'sqlite'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'toml', label: 'TOML', aliases: [] },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
  { id: 'md', label: 'Markdown', aliases: ['markdown'] },
];

/** Fence words that mean "no language": a block that is only monospaced text. */
const PLAIN = new Set(['', 'plain', 'text', 'txt', 'plaintext', 'none']);

const BY_NAME = new Map<string, CodeLanguage>(
  CODE_LANGUAGES.flatMap((language) =>
    [language.id, ...language.aliases].map((name): [string, CodeLanguage] => [
      name,
      language,
    ]),
  ),
);

/** The word after a fence's backticks, without the rest of an info string. */
export function fenceLanguage(info: string | null | undefined): string {
  return (info ?? '').trim().split(/[\s{]/, 1)[0]!.toLowerCase();
}

/** Whether a fence names no language at all, or says so ("text", "plain"). */
export function isPlainFence(info: string | null | undefined): boolean {
  return PLAIN.has(fenceLanguage(info));
}

/** The catalogued language a fence names, or null for plain or unknown ones. */
export function resolveCodeLanguage(
  info: string | null | undefined,
): CodeLanguage | null {
  return BY_NAME.get(fenceLanguage(info)) ?? null;
}

/**
 * What a block's language chip should say: the catalogued label, "Plain text"
 * when no language is named, or the author's own word for one we don't know.
 */
export function codeLanguageLabel(info: string | null | undefined): string {
  if (isPlainFence(info)) return 'Plain text';
  const word = fenceLanguage(info);
  return BY_NAME.get(word)?.label ?? word;
}
