import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { carrySelection } from '../src/components/admin/studioCarrySelection';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    rule: { group: 'block', atom: true },
    text: {},
  },
});
const p = (text: string) =>
  schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: ReturnType<typeof p>[]) =>
  schema.node('doc', null, blocks);

describe('carrySelection', () => {
  it('keeps the caret where it was when the text around it is the same', () => {
    const next = doc(p('hello there'), p('second line, edited elsewhere'));
    const carried = carrySelection(next, { anchor: 5, head: 5 });
    expect(carried.empty).toBe(true);
    expect(carried.head).toBe(5);
  });

  it('keeps a range selection', () => {
    const carried = carrySelection(doc(p('hello there')), {
      anchor: 1,
      head: 6,
    });
    expect([carried.from, carried.to]).toEqual([1, 6]);
  });

  it('lands at the end of a note that got shorter', () => {
    const next = doc(p('short'));
    const carried = carrySelection(next, { anchor: 400, head: 400 });
    expect(carried.head).toBe(next.content.size - 1);
  });

  it('moves off a position text cannot hold to the nearest one that can', () => {
    // Position 0 sits before the first block, where no caret can go.
    const next = doc(p('first'), p('second'));
    const carried = carrySelection(next, { anchor: 0, head: 0 });
    expect(carried.head).toBe(1);
    expect(carried).not.toBeInstanceOf(NodeSelection);
  });
});
