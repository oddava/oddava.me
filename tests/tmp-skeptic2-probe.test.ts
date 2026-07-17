import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderNoteHtml } from '../src/lib/garden/render';
import { getNoteTags } from '../src/lib/garden/utils';

// Temporary probe (skeptic verification) — prints actual behavior for
// emphasis/strikethrough/table-wrapped hashtags. Deleted after the run.

const cases = [
  '**#draft**',
  '_#draft_',
  '*#draft*',
  '~~#gone~~',
  '| a | b |\n| --- | --- |\n|#tag| x |',
  '| a | b |\n| --- | --- |\n| #tag | x |',
  'text **#draft** more',
  '**bold #inbold**',
];

describe('probe', () => {
  it('prints render + extraction for each case', () => {
    const results = cases.map((body) => {
      const html = renderNoteHtml(body);
      const tags = getNoteTags({ body });
      return { body, html, tags, rendersTagLink: html.includes('note-tag') };
    });
    writeFileSync(
      'C:/Users/karim/AppData/Local/Temp/claude/c--Projects-oddava-me/af7fc962-2f2b-4d1e-9ff2-d55d0fcfdfff/scratchpad/probe-results.json',
      JSON.stringify(results, null, 2),
    );
    expect(true).toBe(true);
  });
});
