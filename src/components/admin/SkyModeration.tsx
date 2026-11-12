import {
  clearUnapprovedStars,
  fetchStarEntries,
  updateStarStatus,
  updateRecentStarStatus,
  updateVisitorStarStatus,
} from './api';
import { ModerationInbox } from './ModerationInbox';
import type { StarRecord } from '../../lib/contracts';

interface SkyModerationProps {
  /** Stars whose word waits to be read. */
  pending?: number;
  onChanged: () => void;
}

const name = (star: StarRecord) =>
  star.word ? `“${star.word}”` : 'a star with no word';

/**
 * A star's row: its word, and where it sits, as a dot on a little night.
 * Approving shows the word to everyone; rejecting takes the star out of
 * the sky altogether.
 */
const body = (star: StarRecord) => (
  <div className="adm-star">
    <span
      className="adm-star__map"
      role="img"
      aria-label={`at ${Math.round(star.x * 100)}% across, ${Math.round(
        star.y * 100,
      )}% down`}
    >
      <span
        className="adm-star__dot"
        style={{ left: `${star.x * 100}%`, top: `${star.y * 100}%` }}
      />
    </span>
    <p className="adm-star__state">
      {star.status === 'rejected'
        ? 'out of the sky.'
        : star.word && star.status === 'pending'
          ? 'shining, word hidden until approved.'
          : 'in the sky.'}
    </p>
  </div>
);

export function SkyModeration(props: SkyModerationProps) {
  return (
    <ModerationInbox<StarRecord>
      {...props}
      id="sky"
      title="sky"
      noun="stars"
      load={fetchStarEntries}
      update={updateStarStatus}
      clear={clearUnapprovedStars}
      rejectVisitor={(star) => updateVisitorStarStatus(star.id, 'rejected')}
      rejectLastHour={() => updateRecentStarStatus(60, 'rejected')}
      name={name}
      body={body}
      clearMessage="every pending and rejected star will be deleted, and leave the sky. approved stars stay. this cannot be undone."
    />
  );
}
