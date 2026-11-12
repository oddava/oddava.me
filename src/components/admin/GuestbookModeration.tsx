import {
  clearUnapprovedGuestbookEntries,
  fetchGuestbookEntries,
  updateGuestbookEntryStatus,
} from './api';
import { ModerationInbox } from './ModerationInbox';
import type { GuestbookEntry } from '../../lib/contracts';

interface GuestbookModerationProps {
  /** Entries waiting on a decision; the one count the tabs show. */
  pending?: number;
  /** Called after anything that moves entries between statuses. */
  onChanged: () => void;
}

const name = (entry: GuestbookEntry) => entry.name;

const body = (entry: GuestbookEntry) => (
  <p className="adm-entry__message">{entry.message}</p>
);

/** The guestbook's inbox: the shared moderation inbox over its entries. */
export function GuestbookModeration(props: GuestbookModerationProps) {
  return (
    <ModerationInbox<GuestbookEntry>
      {...props}
      id="guestbook"
      title="guestbook"
      noun="entries"
      load={fetchGuestbookEntries}
      update={updateGuestbookEntryStatus}
      clear={clearUnapprovedGuestbookEntries}
      name={name}
      body={body}
      clearMessage="every pending and rejected entry will be deleted. approved entries stay published. this cannot be undone."
    />
  );
}
