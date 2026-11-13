import { useMemo, useState } from 'preact/hooks';
import type { NoteRevisionDetail } from '../../lib/history-contracts';
import {
  collapseDiff,
  countWords,
  diffWords,
  summarizeDiff,
} from './studioHistory';
import type { DiffRow } from './studioHistory';

type Mode = 'changes' | 'text';

interface Props {
  version: NoteRevisionDetail;
  /** The note as it is on screen now, which is what the changes are against. */
  currentBody: string;
}

function Changes({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === 'skip') {
          return (
            <span key={index} className="studio-history__skip">
              {row.words} unchanged {row.words === 1 ? 'word' : 'words'}
            </span>
          );
        }
        if (row.kind === 'add') {
          return (
            <ins key={index}>
              <span className="studio-visually-hidden">[comes back: </span>
              {row.text}
              <span className="studio-visually-hidden">]</span>
            </ins>
          );
        }
        if (row.kind === 'del') {
          return (
            <del key={index}>
              <span className="studio-visually-hidden">[goes away: </span>
              {row.text}
              <span className="studio-visually-hidden">]</span>
            </del>
          );
        }
        return <span key={index}>{row.text}</span>;
      })}
    </>
  );
}

/**
 * One version beside the note it would replace: what restoring brings back and
 * what it takes away, or just the words as they were.
 */
export default function StudioHistoryPreview({ version, currentBody }: Props) {
  const [mode, setMode] = useState<Mode>('changes');
  // Current to version, so an addition is what restoring writes in and a
  // deletion is what it clears out.
  const segments = useMemo(
    () => diffWords(currentBody, version.body),
    [currentBody, version.body],
  );
  const summary = useMemo(() => summarizeDiff(segments), [segments]);
  const rows = useMemo(() => collapseDiff(segments), [segments]);
  const identical = summary.added === 0 && summary.removed === 0;

  return (
    <div className="studio-history__preview">
      <div className="studio-history__preview-head">
        <div className="studio-history__modes" role="group" aria-label="View">
          <button
            type="button"
            className="press"
            aria-pressed={mode === 'changes'}
            onClick={() => setMode('changes')}
          >
            Changes
          </button>
          <button
            type="button"
            className="press"
            aria-pressed={mode === 'text'}
            onClick={() => setMode('text')}
          >
            Full text
          </button>
        </div>
        <p className="studio-history__summary">
          {identical ? (
            'Same words as now'
          ) : (
            <>
              <span className="is-add" aria-hidden="true">
                +{summary.added}
              </span>
              <span className="is-del" aria-hidden="true">
                −{summary.removed}
              </span>
              <span className="studio-visually-hidden">
                If restored, {summary.added} words come back and{' '}
                {summary.removed} go away.
              </span>
            </>
          )}
        </p>
      </div>
      <div
        className="studio-history__text"
        role="region"
        aria-label={mode === 'changes' ? 'Changes' : 'Version text'}
        tabIndex={0}
      >
        {mode === 'text' ? (
          version.body.trim() ? (
            version.body
          ) : (
            <span className="studio-history__skip">An empty note</span>
          )
        ) : identical ? (
          <span className="studio-history__skip">
            Nothing differs in the words — {countWords(version.body)} of them,
            same as now.
          </span>
        ) : (
          <Changes rows={rows} />
        )}
      </div>
    </div>
  );
}
