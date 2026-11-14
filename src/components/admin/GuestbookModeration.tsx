import {
  clearUnapprovedGuestbookEntries,
  fetchGuestbookEntries,
  updateGuestbookEntryStatus,
  updateRecentGuestbookStatus,
  updateVisitorGuestbookStatus,
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

/**
 * The guestbook's inbox: the shared moderation inbox over its entries.
 * Clean entries publish on their own, so "pending" holds only what the
 * screen flagged; the approved tab is where anything that slipped through
 * is taken down.
 */
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
      rejectVisitor={(entry) =>
        updateVisitorGuestbookStatus(entry.id, 'rejected')
      }
      rejectLastHour={() => updateRecentGuestbookStatus(60, 'rejected')}
      name={name}
      body={body}
      clearMessage="every pending and rejected entry will be deleted. approved entries stay published. this cannot be undone."
    />
  );
}
