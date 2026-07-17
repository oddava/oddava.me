import { describe, expect, it } from 'vitest';
import { renderNoteHtml } from '../src/lib/garden/render';

describe('skeptic repro: hashtag inside image alt', () => {
  it('reproduces the exact claimed alt output', () => {
    const html = renderNoteHtml('![see #tag here](/img.png)');
    expect(html).toContain(
      '<img src="/img.png" alt="see &lt;a class=&quot;note-tag&quot; href=&quot;/notes/tag/tag&quot;&gt;#tag&lt;/a&gt; here">',
    );
  });

  it('counter-hypothesis: alt stays plain text', () => {
    const html = renderNoteHtml('![see #tag here](/img.png)');
    expect(html).toContain('alt="see #tag here"');
  });
});
