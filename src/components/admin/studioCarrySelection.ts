import type { Node as PMNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';

/**
 * Where the caret goes when the open note is replaced from outside — a quiet
 * refresh, their side of a conflict, set-aside text put back, a restore. The
 * same note, mostly the same text: the caret stays at the same distance into
 * it, moved to the nearest place text can go, instead of jumping to the top.
 * Past the end of a shorter note it lands at the end.
 */
export function carrySelection(
  doc: PMNode,
  previous: { anchor: number; head: number },
): Selection {
  const clamp = (position: number) =>
    Math.max(0, Math.min(doc.content.size, position));
  try {
    return TextSelection.between(
      doc.resolve(clamp(previous.anchor)),
      doc.resolve(clamp(previous.head)),
    );
  } catch {
    return Selection.atStart(doc);
  }
}
