// `.sr-only` lives in the public site stylesheet, which AdminLayout does not
// load — admin-side hidden text has to come from this component.
import { VisuallyHidden } from '../ui/VisuallyHidden';
import StudioSelect, { type StudioSelectOption } from './StudioSelect';
import type { StudioTreeItemRef } from './studioDragItems';
import { ROOT_OPTION } from './studioTree';
import type { StudioTreeSelection } from './useStudioTreeSelection';

interface Props {
  selection: StudioTreeSelection;
  /** Folders a bulk move can target. */
  destinations: StudioSelectOption[];
  onBulkMove: (items: StudioTreeItemRef[], folder: string) => Promise<boolean>;
  onBulkDelete: (items: StudioTreeItemRef[]) => Promise<boolean>;
}

/** What the tree's multi-selection can do at once: move, delete, clear. */
export default function StudioTreeBulkBar({
  selection,
  destinations,
  onBulkMove,
  onBulkDelete,
}: Props) {
  const { selectedItems, bulkBusy, runBulk, clearSelection } = selection;
  return (
    <div className="studio-bulk-bar" role="group" aria-label="Selection">
      <strong>
        {selectedItems.length} selected
        <VisuallyHidden>
          . Ctrl-click to add, shift-click for a range.
        </VisuallyHidden>
      </strong>
      <StudioSelect
        className="studio-bulk-bar__move"
        label="Move selection to"
        placeholder="Move to…"
        value=""
        disabled={bulkBusy}
        align="start"
        placement="up"
        options={destinations}
        onChange={(destination) =>
          void runBulk(() =>
            onBulkMove(
              selectedItems,
              destination === ROOT_OPTION ? '' : destination,
            ),
          )
        }
      />
      <button
        type="button"
        className="is-danger"
        disabled={bulkBusy}
        onClick={() => void runBulk(() => onBulkDelete(selectedItems))}
      >
        Delete
      </button>
      <button type="button" disabled={bulkBusy} onClick={clearSelection}>
        Clear
      </button>
    </div>
  );
}
