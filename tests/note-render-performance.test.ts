import { describe, expect, it } from 'vitest';
import { readCallout } from '../src/lib/garden/callouts';
import { readFootnoteDefinition } from '../src/lib/garden/footnotes';
import { renderNoteHtml } from '../src/lib/garden/render';

// Budgets are generous (several times the linear cost on a slow CI runner)
// but far below what the quadratic versions took: ~20s to render 10,000
// paragraphs, ~4s for the block readers, ~3s for a definition's blank run.
function elapsed(task: () => void): number {
  const start = performance.now();
  task();
  return performance.now() - start;
}

describe('note rendering stays linear', () => {
  it('renders 10,000 ordinary paragraphs quickly', () => {
    let html = '';
    const ms = elapsed(() => {
      html = renderNoteHtml('hello\n\n'.repeat(10_000));
    });
    expect(html.match(/<p>hello<\/p>/g)).toHaveLength(10_000);
    expect(ms).toBeLessThan(5_000);
  });

  it('renders 20,000 broken lines quickly', () => {
    const ms = elapsed(() => renderNoteHtml('hello\n'.repeat(20_000)));
    expect(ms).toBeLessThan(5_000);
  });

  it('rejects a non-matching block without reading the rest of the note', () => {
    // Marked offers the block readers every block with the whole remaining
    // note, so each call must cost the first line, not the note.
    const source = 'hello\n\n'.repeat(10_000);
    const ms = elapsed(() => {
      for (let offset = 0; offset < source.length; offset += 7) {
        const rest = source.slice(offset);
        expect(readCallout(rest)).toBeNull();
        expect(readFootnoteDefinition(rest)).toBeNull();
      }
    });
    expect(ms).toBeLessThan(1_500);
  });

  it('walks a definition with a long run of blank lines once', () => {
    const source = `[^a]: x\n${'\n'.repeat(20_000)}  y\nafter`;
    let definition: ReturnType<typeof readFootnoteDefinition> = null;
    const ms = elapsed(() => {
      definition = readFootnoteDefinition(source);
    });
    expect(definition).toEqual({
      id: 'a',
      body: `x${'\n'.repeat(20_000)}\ny`,
      raw: `[^a]: x\n${'\n'.repeat(20_000)}  y`,
    });
    expect(ms).toBeLessThan(500);
  });
});

describe('block readers keep their exact shape', () => {
  it('reads a callout and stops at the first unquoted line', () => {
    expect(readCallout('> [!TIP]\n> one\n>\n> two\nafter\n> not')).toEqual({
      kind: 'tip',
      body: 'one\n\ntwo',
      raw: '> [!TIP]\n> one\n>\n> two',
    });
    expect(readCallout('> [!NOTE]')).toEqual({
      kind: 'note',
      body: '',
      raw: '> [!NOTE]',
    });
    expect(readCallout('> [!NOTE]\n')).toEqual({
      kind: 'note',
      body: '',
      raw: '> [!NOTE]',
    });
    expect(readCallout('> [!NOTE] Title\n> body')).toBeNull();
    expect(readCallout('> plain quote')).toBeNull();
  });

  it('reads a definition without its trailing blank lines', () => {
    expect(readFootnoteDefinition('[^n]: first\n    second\n\n\nnext')).toEqual(
      { id: 'n', body: 'first\nsecond', raw: '[^n]: first\n    second' },
    );
    expect(readFootnoteDefinition('[^n] not a definition')).toBeNull();
  });
});
