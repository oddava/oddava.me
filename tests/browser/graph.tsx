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
const globalData: NoteGraphData = params.has('global')
  ? {
      nodes: [
        ...data.nodes,
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `global-${i}`,
          title: `Further connection ${i}`,
          href: `#global-${i}`,
          incoming: 1,
        })),
      ],
      edges: [
        ...data.edges,
        ...Array.from({ length: 7 }, (_, i) => ({
          source: `note-${i % count}`,
          target: `global-${i}`,
        })),
      ],
    }
  : data;
render(
  <main class="note-reading">
    <article class="notes-sheet note-sheet">
      <h1 class="note-sheet__title">A garden of connected ideas</h1>
      <p>
        Notes are a place to think out loud. Follow a connection, pull on a
        thread, and see where it leads.
      </p>
    </article>
    <section class="note-nearby">
      <div class="note-nearby__graph">
        <InteractiveGraph
          data={data}
          globalData={globalData}
          currentId="note-0"
        />
      </div>
    </section>
    <section class="note-keep">
      <h2 class="notes-label">keep reading</h2>
      <ol class="note-cards">
        <li class="note-card">
          <a class="note-card__link" href="#connections">
            Ideas grow through connections
          </a>
        </li>
        <li class="note-card">
          <a class="note-card__link" href="#practice">
            A practice of attention
          </a>
        </li>
      </ol>
    </section>
  </main>,
  document.getElementById('app')!,
);
