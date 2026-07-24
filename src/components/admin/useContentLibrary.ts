import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type {
  ContentCollectionMeta,
  ContentEntryListItem,
  ContentFolder,
} from '../../lib/contracts';
import { fetchContentCollections, fetchContentEntries } from './api';
import { contentRequestError } from './studioHelpers';

export interface ContentLibrary {
  collection: ContentCollectionMeta | null;
  entries: ContentEntryListItem[];
  setEntries: Dispatch<StateUpdater<ContentEntryListItem[]>>;
  folders: ContentFolder[];
  loading: boolean;
  refreshTree: () => Promise<void>;
}

/** The live file listing: one collection, its entries and its folder nodes. */
export function useContentLibrary(
  onError: (message: string) => void,
): ContentLibrary {
  const [collection, setCollection] = useState<ContentCollectionMeta | null>(
    null,
  );
  const [entries, setEntries] = useState<ContentEntryListItem[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refreshTree = useCallback(async () => {
    if (!collection) return;
    const response = await fetchContentEntries(collection.id);
    setEntries(response.entries);
    setFolders(response.folders ?? []);
  }, [collection]);

  useEffect(() => {
    let active = true;
    void fetchContentCollections()
      .then(async (response) => {
        if (!active) return;
        const first = response.collections[0] ?? null;
        setCollection(first);
        if (first) {
          const entryResponse = await fetchContentEntries(first.id);
          if (!active) return;
          setEntries(entryResponse.entries);
          setFolders(entryResponse.folders ?? []);
        }
      })
      .catch((caught) => {
        if (!active) return;
        onErrorRef.current(
          contentRequestError(caught, 'Could not load Files.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { collection, entries, setEntries, folders, loading, refreshTree };
}
