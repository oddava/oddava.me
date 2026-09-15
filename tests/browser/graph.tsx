import { render } from 'preact';
import InteractiveGraph from '../../src/components/garden/InteractiveGraph';
import type { NoteGraphData } from '../../src/lib/garden/graph';
import '../../src/styles/global.css';
import '../../src/styles/components/_garden.css';
const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? 9);
const titles = [
  'A garden of connected ideas',
  'Learning in public',
  'Writing to understand',
  'Attention and intention',
  'The shape of a good question',
  'Small tools, lasting systems',
  'Reading as a conversation',
  'Digital gardens',
  'Making room for curiosity',
];
const data: NoteGraphData = {
  nodes: Array.from({ length: count }, (_, i) => ({
    id: `note-${i}`,
    title: titles[i % titles.length] + (i >= titles.length ? ` ${i}` : ''),
    href: `#note-${i}`,
    incoming: i === 0 ? 8 : i % 4,
  })),
  edges: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    source: `note-${Math.floor(i / 3)}`,
    target: `note-${i + 1}`,
  })),
};
const fullPage = params.has('full');
render(
  fullPage ? (
    <InteractiveGraph data={data} currentId="note-0" fullPage />
  ) : (
    <div class="garden-page">
      <div class="garden-document-layout">
        <aside class="note-context">
          <div class="note-context__inner">
            <InteractiveGraph
              data={data}
              globalData={data}
              currentId="note-0"
            />
            <nav class="note-toc note-toc--rail note-context__section">
              <h2 class="note-context__label">In this note</h2>
              <ol class="note-toc__list">
                <li>
                  <a href="#connections" class="note-toc__link">
                    Ideas grow through connections
                  </a>
                </li>
                <li>
                  <a href="#practice" class="note-toc__link">
                    A practice of attention
                  </a>
                </li>
              </ol>
            </nav>
          </div>
        </aside>
        <article class="garden-document">
          <h1>A garden of connected ideas</h1>
          <p>
            Notes are a place to think out loud. Follow a connection, pull on a
            thread, and see where it leads.
          </p>
          <h2 id="connections">Ideas grow through connections</h2>
          <p>
            A thought rarely stands alone. The links between notes make room for
            discoveries that a folder could never quite contain.
          </p>
          <h2 id="practice">A practice of attention</h2>
          <p>Keep a little space for curiosity.</p>
        </article>
      </div>
    </div>
  ),
  document.getElementById('app')!,
);
