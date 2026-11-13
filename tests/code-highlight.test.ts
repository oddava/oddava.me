import { describe, expect, it } from 'vitest';
import {
  CODE_LANGUAGES,
  codeLanguageLabel,
  fenceLanguage,
  resolveCodeLanguage,
} from '../src/lib/garden/code-languages';
import { highlightToHtml, tokenizeCode } from '../src/lib/garden/highlight';

/** The text each token covers, as `kind:text`, for readable assertions. */
function tokens(code: string, info: string): string[] {
  return tokenizeCode(code, info).map(
    ({ from, to, kind }) => `${kind}:${code.slice(from, to)}`,
  );
}

describe('code languages', () => {
  it('resolves fence spellings and aliases to one catalogued language', () => {
    expect(resolveCodeLanguage('ts')?.id).toBe('ts');
    expect(resolveCodeLanguage('TypeScript')?.id).toBe('ts');
    expect(resolveCodeLanguage('sh')?.id).toBe('bash');
    expect(resolveCodeLanguage('c++')?.id).toBe('cpp');
  });

  it('reads only the language word from a longer info string', () => {
    expect(fenceLanguage('ts title="a.ts"')).toBe('ts');
    expect(fenceLanguage('js {1,3}')).toBe('js');
    expect(resolveCodeLanguage('python linenos')?.id).toBe('python');
  });

  it('labels plain, known and unknown languages for the chip', () => {
    expect(codeLanguageLabel(null)).toBe('Plain text');
    expect(codeLanguageLabel('text')).toBe('Plain text');
    expect(codeLanguageLabel('ts')).toBe('TypeScript');
    expect(codeLanguageLabel('haskell')).toBe('haskell');
  });

  it('keeps every id and alias unique', () => {
    const names = CODE_LANGUAGES.flatMap((l) => [l.id, ...l.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('tokenizeCode', () => {
  it('highlights keywords, strings, numbers, comments and calls in TypeScript', () => {
    expect(tokens('const n: number = 42; // answer\nrun("x");', 'ts')).toEqual([
      'kw:const',
      'num:42',
      'com:// answer',
      'fn:run',
      'str:"x"',
    ]);
  });

  it('keeps a keyword inside an identifier plain', () => {
    expect(tokens('const constant = format', 'js')).toEqual(['kw:const']);
  });

  it('closes an unterminated block comment at the end of the block', () => {
    expect(tokens('a /* never closed\nb', 'js')).toEqual([
      'com:/* never closed\nb',
    ]);
  });

  it('separates JSON keys from values', () => {
    expect(tokens('{"a": "b", "n": 1.5, "ok": true}', 'json')).toEqual([
      'prop:"a"',
      'str:"b"',
      'prop:"n"',
      'num:1.5',
      'prop:"ok"',
      'lit:true',
    ]);
  });

  it('reads CSS declarations as properties but not pseudo-class selectors', () => {
    expect(tokens('a:hover { color: #fff; }', 'css')).toEqual([
      'prop:color',
      'num:#fff',
    ]);
  });

  it('highlights shell commands, flags and variables', () => {
    expect(tokens('$ npm install --save "$HOME"', 'bash')).toEqual([
      'punct:$',
      'fn:npm',
      'attr:--save',
      'str:"$HOME"',
    ]);
  });

  it('only treats a string after = as an HTML attribute value', () => {
    expect(tokens('<a href="/x">don\'t</a>', 'html')).toEqual([
      'tag:<a',
      'attr:href',
      'str:"/x"',
      'tag:>',
      'tag:</a',
      'tag:>',
    ]);
  });

  it('colours added and removed diff lines', () => {
    expect(tokens('@@ -1 +1 @@\n-old\n+new', 'diff')).toEqual([
      'attr:@@ -1 +1 @@',
      'del:-old',
      'ins:+new',
    ]);
  });

  it('covers the SQL, Python and Rust basics', () => {
    expect(tokens("SELECT id FROM t WHERE x = 'a'", 'sql')).toEqual([
      'kw:SELECT',
      'kw:FROM',
      'kw:WHERE',
      "str:'a'",
    ]);
    expect(tokens('def f(self):\n    return None', 'python')).toEqual([
      'kw:def',
      'fn:f',
      'kw:self',
      'kw:return',
      'lit:None',
    ]);
    expect(tokens('fn main() { println!("hi"); }', 'rust')).toEqual([
      'kw:fn',
      'fn:main',
      'fn:println!',
      'str:"hi"',
    ]);
  });

  it('returns nothing for plain, unknown and oversized blocks', () => {
    expect(tokenizeCode('const a = 1', null)).toEqual([]);
    expect(tokenizeCode('const a = 1', 'text')).toEqual([]);
    expect(tokenizeCode('const a = 1', 'brainfuck')).toEqual([]);
    expect(tokenizeCode('a'.repeat(40_000), 'js')).toEqual([]);
  });

  it('never produces overlapping or out-of-order ranges', () => {
    const samples = [
      "const a = `x${y}` + 'it\\'s' // c\n/* d */",
      '<div class="a">&amp;</div><!-- x -->',
      'if [ -f "$x" ]; then echo $(date) # c\nfi',
      'x = """doc\nstring""" + f"{a}"  # c',
    ];
    for (const code of samples) {
      for (const { id } of CODE_LANGUAGES) {
        let end = 0;
        for (const { from, to } of tokenizeCode(code, id)) {
          expect(from).toBeGreaterThanOrEqual(end);
          expect(to).toBeGreaterThan(from);
          end = to;
        }
        expect(end).toBeLessThanOrEqual(code.length);
      }
    }
  });
});

describe('highlightToHtml', () => {
  it('escapes code and wraps tokens in class-only spans', () => {
    const html = highlightToHtml('if (a < b && "<x>") {}', 'js');
    expect(html).toBe(
      '<span class="tok-kw">if</span> (a &lt; b &amp;&amp; <span class="tok-str">"&lt;x&gt;"</span>) {}',
    );
    expect(html).not.toContain('style=');
  });

  it('escapes unhighlighted code too', () => {
    expect(highlightToHtml('<b>&</b>', 'text')).toBe(
      '&lt;b&gt;&amp;&lt;/b&gt;',
    );
  });
});
