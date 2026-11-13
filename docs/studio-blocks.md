# Studio blocks: code languages, callouts, footnotes

Three constructs that used to fall back to a raw "custom block" are real
editor nodes and real page output. The syntax is shared by the public renderer
and Studio, so the two cannot disagree about what a note means.

| Construct | Markdown                          | Editor node                          | Page output                                |
| --------- | --------------------------------- | ------------------------------------ | ------------------------------------------ |
| Code      | ` ```ts `                         | `codeBlock` with a `language` attr   | `<pre data-language>` + `tok-*` spans      |
| Callout   | `> [!NOTE]` + `>` body lines      | `callout` (`kind`, `block+`)         | `.callout.callout--note` card              |
| Footnote  | `text[^1]` and `[^1]: text` below | `footnoteRef` + `footnoteDefinition` | numbered `<sup>` and a list after the note |

## Where things live

- `src/lib/garden/` is the shared layer, with no editor dependency:
  `code-languages.ts` (the catalogue and aliases), `highlight.ts` +
  `highlight-grammars.ts` (the tokenizer), `callouts.ts`, `footnotes.ts`
  (reading and writing the syntax). `render-callouts.ts` and
  `render-footnotes.ts` are the `marked` halves, registered in `render.ts`.
- `src/components/admin/studio{CodeBlock,Callout,Footnotes}.ts` are the
  TipTap extensions; `studioBlockExtensions.ts` lists them and
  `studioBlockCommands.ts` holds what the slash menu does.
  `studioPicker.ts` is the small floating list the language chip and the
  callout's kind button open.
- Styling: how a block _looks_ is `_note-prose.css` (loaded by the page and by
  the editor); only editor chrome — chips, picker, footnote jump — is in
  `studio/_blocks.css`.

## Why the highlighter is hand-written

Astro's CSP is hashed and `markdown.syntaxHighlight` is off on purpose: Shiki
writes inline `style` attributes, which would force `style-src 'unsafe-inline'`.
The tokenizer emits class names only (`tok-kw`, `tok-str`, …) and the
stylesheet colours them from the site's `--color-*` tokens, so nothing
loosens the policy and the colours follow the theme. It adds no dependency;
the only `package.json` change is declaring `@tiptap/extension-code-block`,
which StarterKit already installed, because Studio now imports it directly to
extend the stock block.

The grammars are deliberately modest — ordered regular expressions, first
match wins — which reads well in a note. Adding a language means one entry in
`code-languages.ts` and one in `highlight-grammars.ts`. Blocks over 30,000
characters and unknown languages render plain.

## Lossless round trips

`RichDocument` keeps the original Markdown of any block that was not edited, so
opening and saving a note never rewrites it. Edited blocks go through the
serializers above. Anything the schema cannot hold whole stays a source block
rather than being half-converted:

- a callout marker with a title (`> [!NOTE] Title`) is an ordinary quote;
- a callout with lazy continuation lines, or nested in a list, stays source;
- footnote ids other than word characters and dashes (`[^a note]`) stay source.
