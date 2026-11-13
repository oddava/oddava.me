import type { ContentEntryDetail } from '../../lib/contracts';
import StudioHistoryList from './StudioHistoryList';
import StudioHistoryPreview from './StudioHistoryPreview';
import StudioSheet from './StudioSheet';
import { Icon } from './studioIcons';
import { titleFromBody } from './studioHelpers';
import { useStudioHistory } from './useStudioHistory';
import type { StudioDocument } from './useStudioDocument';

interface Props {
  open: boolean;
  collectionId: string | null;
  doc: StudioDocument;
  title: string;
  /** A phone: the history rises as a sheet instead of sliding in as a drawer. */
  compact: boolean;
  /** A write landed — the workspace refreshes the note's row from this. */
  onSaved: (id: string, revision: string, title: string, icon?: string) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

/**
 * A note's past, kept as it is saved. Pick a version, see what restoring it
 * would change, and bring it back — the note you replace is kept first, so a
 * restore is never a one-way door.
 */
export default function StudioHistoryPanel({
  open,
  collectionId,
  doc,
  title,
  compact,
  onSaved,
  onNotice,
  onClose,
}: Props) {
  const history = useStudioHistory({
    open,
    collectionId,
    noteId: doc.openId,
    flush: doc.saveNow,
    currentRevision: () => doc.docRef.current?.revision ?? '',
    onRestored: (entry: ContentEntryDetail) => {
      doc.patch({
        fields: entry.fields,
        body: entry.body,
        revision: entry.revision,
      });
      doc.setBody(entry.body);
      onSaved(
        entry.id,
        entry.revision,
        titleFromBody(entry.body, entry.id),
        typeof entry.fields.icon === 'string' ? entry.fields.icon : undefined,
      );
      onNotice('Restored. The version it replaced is still in history.');
      onClose();
    },
  });
  const { status, versions, detail } = history;

  return (
    <StudioSheet
      open={open}
      title="Version history"
      detail={title}
      side={compact ? 'bottom' : 'right'}
      onClose={onClose}
    >
      <div className="studio-history" data-status={status}>
        {status === 'loading' && (
          <div className="studio-history__empty" role="status">
            <span className="studio-history__bubble" aria-hidden="true">
              <Icon name="history" />
            </span>
            <p className="studio-history__lead">Turning back the pages…</p>
            <div className="studio-history__shimmer" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="studio-history__empty" role="alert">
            <span className="studio-history__bubble" aria-hidden="true">
              <Icon name="history" />
            </span>
            <p className="studio-history__lead">Couldn’t open the history</p>
            <p className="studio-history__hint">
              Your note is fine — try again in a moment.
            </p>
            <button
              type="button"
              className="studio-btn press"
              onClick={history.retry}
            >
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && versions.length === 0 && (
          <div className="studio-history__empty">
            <span className="studio-history__bubble" aria-hidden="true">
              <Icon name="history" />
            </span>
            <p className="studio-history__lead">Nothing to go back to yet</p>
            <p className="studio-history__hint">
              While you write, Studio tucks away a copy about every five
              minutes. Keep going — the first one will be here soon.
            </p>
          </div>
        )}

        {status === 'ready' && versions.length > 0 && (
          <>
            <StudioHistoryList
              versions={versions}
              selectedId={history.selectedId}
              now={history.now}
              onSelect={history.select}
            />
            <div className="studio-history__detail">
              {detail ? (
                <StudioHistoryPreview
                  key={detail.id}
                  version={detail}
                  currentBody={doc.body}
                />
              ) : history.detailError ? (
                <p className="studio-history__hint" role="alert">
                  {history.detailError}
                </p>
              ) : (
                <p className="studio-history__hint" role="status">
                  Opening that version…
                </p>
              )}
            </div>
            <footer className="studio-history__foot">
              {history.restoreError && (
                <p className="studio-history__error" role="alert">
                  {history.restoreError}
                </p>
              )}
              <button
                type="button"
                className="studio-btn studio-btn--primary press"
                disabled={!detail || history.restoring}
                onClick={() => void history.restore()}
              >
                {history.restoring ? 'Restoring…' : 'Restore this version'}
              </button>
              <p className="studio-history__hint">
                What you have now is kept in history first, so you can undo
                this.
              </p>
            </footer>
          </>
        )}
      </div>
    </StudioSheet>
  );
}
