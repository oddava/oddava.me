// Grammars for the code highlighter: ordered regular expressions, first match
// wins at each position. They aim for "reads well in a note", not for parsing —
// the page's CSP forbids inline styles, so a grammar only ever names a token
// class and the stylesheet decides the colour.

export type TokenKind =
  | 'kw'
  | 'lit'
  | 'str'
  | 'num'
  | 'com'
  | 'fn'
  | 'type'
  | 'prop'
  | 'attr'
  | 'tag'
  | 'var'
  | 'punct'
  | 'ins'
  | 'del';

/** A rule with no kind consumes text silently, so a word is never matched mid-way. */
export interface Rule {
  kind: TokenKind | null;
  pattern: RegExp;
}

// Sticky so a rule only ever matches at the scan position; multiline so `^`
// means "start of a line" for the grammars that care (diff, YAML, shell).
function rule(kind: TokenKind | null, source: string, flags = ''): Rule {
  return { kind, pattern: new RegExp(source, `ym${flags}`) };
}

// `$` in a multiline rule means end of line, so "unterminated, runs to the end
// of the block" needs its own spelling.
const EOF = '(?![\\s\\S])';

const words = (list: string): string =>
  `\\b(?:${list.split(' ').join('|')})\\b`;

const lineComment = (opener: string) => rule('com', `${opener}[^\\n]*`);
const blockComment = rule('com', `/\\*[\\s\\S]*?(?:\\*/|${EOF})`);
const doubleQuoted = rule('str', '"(?:\\\\.|[^"\\\\\\n])*"?');
const singleQuoted = rule('str', "'(?:\\\\.|[^'\\\\\\n])*'?");
const backtick = rule('str', '`(?:\\\\[\\s\\S]|[^`\\\\])*`?');
const number = rule(
  'num',
  '\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)[a-zA-Z]{0,3}\\b',
);
const identifier = rule(null, '[A-Za-z_$][\\w$]*');
const call = rule('fn', '[A-Za-z_$][\\w$]*(?=\\s*\\()');
const pascal = rule('type', '[A-Z][\\w$]*');

/** The shared shape of C-descended languages: comments, strings, then words. */
function cLike(keywords: string, literals: string, extra: Rule[] = []): Rule[] {
  return [
    lineComment('//'),
    blockComment,
    ...extra,
    doubleQuoted,
    singleQuoted,
    rule('kw', words(keywords)),
    rule('lit', words(literals)),
    number,
    call,
    pascal,
    identifier,
  ];
}

const JS_KEYWORDS =
  'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static switch throw try typeof var void while with yield';
const TS_KEYWORDS = `${JS_KEYWORDS} abstract declare enum implements interface is keyof namespace override private protected public readonly satisfies type`;
const JS_LITERALS = 'true false null undefined NaN Infinity this super';

function script(keywords: string): Rule[] {
  return [
    lineComment('//'),
    blockComment,
    doubleQuoted,
    singleQuoted,
    backtick,
    rule('kw', words(keywords)),
    rule('lit', words(JS_LITERALS)),
    number,
    call,
    pascal,
    identifier,
  ];
}

const json: Rule[] = [
  rule('prop', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'),
  doubleQuoted,
  rule('lit', words('true false null')),
  rule('num', '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'),
  lineComment('//'),
  blockComment,
];

const css: Rule[] = [
  blockComment,
  doubleQuoted,
  singleQuoted,
  rule('kw', '@[\\w-]+|!important'),
  rule('prop', '--[\\w-]+'),
  // A declaration ends in `;` or `}` before any `{` — which keeps `a:hover {`
  // from being read as a property.
  rule('prop', '-?[a-zA-Z][\\w-]*(?=\\s*:[^;{}]*[;}])'),
  rule('num', '#[\\da-fA-F]{3,8}\\b'),
  rule('num', '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[a-zA-Z%]+)?'),
  rule('fn', '-?[a-zA-Z][\\w-]*(?=\\()'),
  rule('type', '[.#][A-Za-z_-][\\w-]*'),
  rule(null, '-?[A-Za-z_][\\w-]*'),
];

const html: Rule[] = [
  rule('com', `<!--[\\s\\S]*?(?:-->|${EOF})`),
  rule('kw', '<![A-Za-z][^>\\n]*>?'),
  rule('tag', '</?[A-Za-z][\\w:.-]*'),
  rule('tag', '/?>'),
  rule('attr', '[A-Za-z_:@][\\w:.@-]*(?=\\s*=)'),
  rule('str', '(?<==\\s*)(?:"[^"]*"?|\'[^\']*\'?)'),
  rule('lit', '&#?\\w+;'),
];

const bash: Rule[] = [
  rule('com', '(?<![\\w$])#[^\\n]*'),
  rule('str', '"(?:\\\\[\\s\\S]|[^"\\\\])*"?'),
  rule('str', "'[^']*'?"),
  rule('var', '\\$(?:[A-Za-z_]\\w*|\\{[^}\\n]*\\}?|[0-9@#?*!$-])'),
  rule('punct', '^\\$(?=[ \\t])'),
  rule('attr', '(?<=\\s)--?[A-Za-z][\\w-]*'),
  rule(
    'kw',
    words(
      'if then elif else fi for while until do done case esac in function return export local readonly unset set source alias exit break continue',
    ),
  ),
  rule('num', '\\b\\d+\\b'),
  // The first word of a command, including after a `$ ` prompt.
  rule('fn', '(?<=(?:^|[|;&(]|\\$\\(|^\\$)[ \\t]*)[A-Za-z_./~][\\w./~-]*'),
  rule(null, '[\\w./~-]+'),
];

const python: Rule[] = [
  lineComment('#'),
  rule(
    'str',
    `(?:[rRbBfFuU]{1,2})?(?:"""[\\s\\S]*?(?:"""|${EOF})|'''[\\s\\S]*?(?:'''|${EOF}))`,
  ),
  rule(
    'str',
    `(?:[rRbBfFuU]{1,2})?(?:"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?)`,
  ),
  rule('attr', '(?<=^[ \\t]*)@[\\w.]+'),
  rule(
    'kw',
    words(
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls',
    ),
  ),
  rule('lit', words('True False None')),
  number,
  call,
  pascal,
  rule(null, '[A-Za-z_]\\w*'),
];

const rust: Rule[] = [
  lineComment('//'),
  blockComment,
  rule('attr', '#!?\\[[^\\]\\n]*\\]?'),
  rule('str', 'b?"(?:\\\\[\\s\\S]|[^"\\\\])*"?'),
  rule('str', "b?'(?:\\\\[^'\\n]*|[^'\\\\\\n])'"),
  rule('attr', "'[a-z_]\\w*\\b(?!')"),
  rule('fn', '\\b[A-Za-z_]\\w*!'),
  rule(
    'kw',
    words(
      'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
    ),
  ),
  rule('lit', words('true false')),
  number,
  call,
  pascal,
  rule(null, '[A-Za-z_]\\w*'),
];

const go: Rule[] = [
  lineComment('//'),
  blockComment,
  doubleQuoted,
  rule('str', '`[^`]*`?'),
  rule('str', "'(?:\\\\.[^'\\n]*|[^'\\\\\\n])'"),
  rule(
    'kw',
    words(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    ),
  ),
  rule('lit', words('true false nil iota')),
  rule(
    'type',
    words(
      'int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 string bool byte rune error any',
    ),
  ),
  number,
  call,
  pascal,
  rule(null, '[A-Za-z_]\\w*'),
];

const c = cLike(
  'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while',
  'true false NULL',
  [rule('kw', '(?<=^[ \\t]*)#[ \\t]*[a-z]+')],
);

const cpp = cLike(
  'alignas auto break case catch class const constexpr continue default delete do else enum explicit extern for friend goto if inline namespace new noexcept operator override private protected public return sizeof static struct switch template throw try typedef typename union using virtual volatile while',
  'true false nullptr NULL this',
  [rule('kw', '(?<=^[ \\t]*)#[ \\t]*[a-z]+')],
);

const java = cLike(
  'abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized throw throws transient try void volatile while var record',
  'true false null this',
  [rule('attr', '@[A-Za-z_]\\w*')],
);

const csharp = cLike(
  'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch throw try typeof unchecked unsafe using var virtual void volatile while record',
  'true false null this',
  [rule('attr', '(?<=^[ \\t]*)\\[[A-Za-z_][^\\]\\n]*\\]')],
);

const sql: Rule[] = [
  lineComment('--'),
  blockComment,
  rule('str', "'(?:''|[^'])*'?"),
  rule('prop', '"[^"\\n]*"?'),
  {
    kind: 'kw',
    pattern: new RegExp(
      words(
        'select from where and or not in is as join left right inner outer full cross on group by order having limit offset insert into values update set delete create alter drop table index view database primary key foreign references unique default check constraint distinct union all case when then else end exists between like ilike with returning begin commit rollback grant revoke truncate asc desc',
      ),
      'yi',
    ),
  },
  rule('lit', '\\b(?:null|true|false)\\b', 'i'),
  rule('num', '\\b\\d+(?:\\.\\d+)?\\b'),
  rule('fn', '[A-Za-z_]\\w*(?=\\s*\\()'),
  rule(null, '[A-Za-z_]\\w*'),
];

const yaml: Rule[] = [
  rule('com', '(?<=^|\\s)#[^\\n]*'),
  rule('kw', '^(?:---|\\.\\.\\.)(?=\\s|$)'),
  rule(
    'prop',
    '(?<=^[ \\t]*(?:-[ \\t]+)?)[^\\s#:\'"&*!|>%@`-][^:#\\n]*?(?=:(?:\\s|$))',
  ),
  doubleQuoted,
  singleQuoted,
  rule('attr', '[&*][\\w-]+'),
  rule('lit', words('true false null yes no on off')),
  rule('num', '(?<![\\w.-])-?\\d+(?:\\.\\d+)?(?![\\w.-])'),
];

const toml: Rule[] = [
  lineComment('#'),
  rule('tag', '^[ \\t]*\\[\\[?[^\\]\\n]+\\]\\]?'),
  rule('prop', '^[ \\t]*[\\w.-]+(?=[ \\t]*=)'),
  rule('str', '"""[\\s\\S]*?(?:"""|' + EOF + ')'),
  doubleQuoted,
  singleQuoted,
  rule('lit', words('true false')),
  number,
];

const diff: Rule[] = [
  rule('com', '^(?:\\+\\+\\+|---|diff |index )[^\\n]*'),
  rule('attr', '^@@[^\\n]*'),
  rule('ins', '^\\+[^\\n]*'),
  rule('del', '^-[^\\n]*'),
];

const markdown: Rule[] = [
  rule('kw', '^#{1,6}[ \\t][^\\n]*'),
  rule('str', '`[^`\\n]+`'),
  rule('fn', '\\[[^\\]\\n]*\\]\\([^)\\n]*\\)'),
  rule('punct', '^[ \\t]*(?:[-*+]|\\d+\\.|>)(?=[ \\t])'),
];

/** Grammars by catalogued language id (see code-languages.ts). */
export const GRAMMARS: Readonly<Record<string, readonly Rule[]>> = {
  js: script(JS_KEYWORDS),
  jsx: script(JS_KEYWORDS),
  ts: script(TS_KEYWORDS),
  tsx: script(TS_KEYWORDS),
  json,
  css,
  html,
  bash,
  python,
  rust,
  go,
  c,
  cpp,
  csharp,
  java,
  sql,
  yaml,
  toml,
  diff,
  md: markdown,
};
