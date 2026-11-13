import type { TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import type { NoteRevisionMeta } from '../../lib/history-contracts';
import {
  formatVersionAge,
  formatVersionExact,
  groupVersionsByDay,
  versionTimestamp,
} from './studioHistory';

interface Props {
  versions: NoteRevisionMeta[];
  selectedId: string | null;
  now: number;
  onSelect: (id: string) => void;
}

/**
 * Every kept version, newest first, under the day it belongs to. Arrow keys
 * walk the list and the preview follows, since a version is cheap to look at.
 */
export default function StudioHistoryList({
  versions,
  selectedId,
  now,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
    next?.click();
  }

  return (
    <div
      ref={listRef}
      className="studio-history__list"
      role="group"
      aria-label="Saved versions"
      onKeyDown={onKeyDown}
    >
      {groupVersionsByDay(versions, now).map((group) => (
        <section key={group.label} className="studio-history__day">
          <h3 className="studio-history__day-label">{group.label}</h3>
          {group.versions.map((version) => {
            const timestamp = versionTimestamp(version);
            return (
              <button
                key={version.id}
                type="button"
                className="studio-history__version press"
                aria-pressed={version.id === selectedId}
                onClick={() => onSelect(version.id)}
              >
                <time
                  dateTime={new Date(timestamp).toISOString()}
                  title={formatVersionExact(timestamp)}
                >
                  {/* Under "Yesterday" or a date, the row is the time of
                      day: the heading has already said which day. */}
                  {group.label === 'Today'
                    ? formatVersionAge(timestamp, now)
                    : new Date(timestamp).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                </time>
                {version.reason === 'pre-restore' && (
                  <span className="studio-history__tag">Before a restore</span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
