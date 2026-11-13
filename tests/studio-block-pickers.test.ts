import { describe, expect, it } from 'vitest';
import {
  codeLanguageOptions,
  currentCodeLanguage,
  customLanguageOption,
  languageFromPick,
} from '../src/components/admin/studioCodeLanguages';
import {
  filterPickerOptions,
  type PickerOption,
} from '../src/components/admin/studioPicker';

const OPTIONS: PickerOption[] = [
  { id: 'plain', label: 'Plain text', keywords: 'none' },
  { id: 'ts', label: 'TypeScript', hint: 'ts', keywords: 'typescript' },
  { id: 'js', label: 'JavaScript', hint: 'js', keywords: 'node' },
  { id: 'json', label: 'JSON', hint: 'json' },
  { id: 'csharp', label: 'C#', hint: 'csharp', keywords: 'cs' },
];

describe('filterPickerOptions', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(filterPickerOptions(OPTIONS, '  ').map((o) => o.id)).toEqual(
      OPTIONS.map((o) => o.id),
    );
  });

  it('ranks an exact id over a prefix over a keyword', () => {
    expect(filterPickerOptions(OPTIONS, 'js').map((o) => o.id)).toEqual([
      'js',
      'json',
    ]);
    expect(filterPickerOptions(OPTIONS, 'type')[0]?.id).toBe('ts');
    expect(filterPickerOptions(OPTIONS, 'node').map((o) => o.id)).toEqual([
      'js',
    ]);
  });

  it('matches the start of any word in a label, ignoring case', () => {
    expect(filterPickerOptions(OPTIONS, 'TEXT').map((o) => o.id)).toEqual([
      'plain',
    ]);
  });

  it('is empty when nothing matches, and never mutates its input', () => {
    const before = [...OPTIONS];
    expect(filterPickerOptions(OPTIONS, 'zzz')).toEqual([]);
    expect(OPTIONS).toEqual(before);
  });
});

describe('code language choices', () => {
  it('lists plain text first, then the catalogue', () => {
    const options = codeLanguageOptions(null);
    expect(options[0]).toMatchObject({ id: 'plain', label: 'Plain text' });
    expect(options.map((o) => o.id)).toEqual(
      expect.arrayContaining(['ts', 'python', 'bash', 'json', 'css']),
    );
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  });

  it('finds a language by its alias', () => {
    const found = filterPickerOptions(codeLanguageOptions(null), 'typescript');
    expect(found[0]?.id).toBe('ts');
    expect(
      filterPickerOptions(codeLanguageOptions(null), 'golang')[0]?.id,
    ).toBe('go');
  });

  it('keeps a language outside the catalogue that the block already uses', () => {
    const options = codeLanguageOptions('haskell');
    expect(options[1]).toMatchObject({ id: 'haskell', hint: 'custom' });
    expect(currentCodeLanguage('haskell')).toBe('haskell');
  });

  it('reports the catalogued id for an alias, and plain for none', () => {
    expect(currentCodeLanguage('typescript')).toBe('ts');
    expect(currentCodeLanguage('sh title="x"')).toBe('bash');
    expect(currentCodeLanguage(null)).toBe('plain');
    expect(currentCodeLanguage('text')).toBe('plain');
  });

  it('offers a typed word as a language only if a fence could carry it', () => {
    expect(customLanguageOption(' Zig ')).toMatchObject({ id: 'zig' });
    expect(customLanguageOption('c++')).toMatchObject({ id: 'c++' });
    expect(customLanguageOption('two words')).toBeNull();
    expect(customLanguageOption('```')).toBeNull();
    expect(customLanguageOption('')).toBeNull();
  });

  it('writes no language for plain text and the id for anything else', () => {
    expect(languageFromPick('plain')).toBeNull();
    expect(languageFromPick('ts')).toBe('ts');
  });
});
