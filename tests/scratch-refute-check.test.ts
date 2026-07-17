import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderNoteHtml } from '../src/lib/garden/render';
import { bodyProvidesTitleHeading, deriveTitle } from '../src/lib/garden/utils';

const OUT =
  'C:\\Users\\karim\\AppData\\Local\\Temp\\claude\\c--Projects-oddava-me\\af7fc962-2f2b-4d1e-9ff2-d55d0fcfdfff\\scratchpad\\trace.json';

describe('reviewer claim trace', () => {
  it('traces both scenarios', () => {
    const bodyA = '## Reading log\n\nsome entries here.';
    const bodyB = 'intro paragraph\n\n# Real Title\n\nrest of the note.';
    const result = {
      A: {
        title: deriveTitle(bodyA, 'reading-log.md'),
        showShellTitle: !bodyProvidesTitleHeading(bodyA),
        html: renderNoteHtml(bodyA),
      },
      B: {
        title: deriveTitle(bodyB, 'real-title.md'),
        showShellTitle: !bodyProvidesTitleHeading(bodyB),
        html: renderNoteHtml(bodyB),
      },
    };
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    expect(true).toBe(true);
  });
});
