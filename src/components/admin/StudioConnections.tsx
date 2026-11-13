import { useId, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { OutboundLink } from '../../lib/garden/connections';
import { FileIcon } from './studioFileIcons';
import { Icon } from './studioIcons';
import {
  NO_BACKLINKS,
  NO_OUTBOUND,
  backlinksHeading,
  orderOutbound,
  outboundHeading,
  unwrittenCount,
} from './studioConnectionText';
import type { ConnectionsState } from './useStudioConnections';

type Unwritten = Extract<OutboundLink, { kind: 'unwritten' }>;

interface Props {
  state: ConnectionsState;
  /** Opens the note at this path in Studio. */
  onOpen: (path: string) => void;
  /** Makes the note a dangling `[[link]]` names; true once it exists. */
  onCreate: (link: Unwritten) => Promise<boolean>;
}

function Disclosure({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="studio-connections__group">
      <button
        type="button"
        className="studio-connections__toggle"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron-right" />
        <span>{title}</span>
        {badge && (
          <span className="studio-sticker studio-sticker--ink">{badge}</span>
        )}
      </button>
      <div id={panel} className="studio-connections__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function Card({
  path,
  title,
  icon,
  sentence,
  onOpen,
}: {
  path: string;
  title: string;
  icon?: string;
  sentence?: string;
  onOpen: (path: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="studio-connection-card"
        onClick={() => onOpen(path)}
      >
        <span className="studio-connection-card__icon" aria-hidden="true">
          <FileIcon icon={icon} />
        </span>
        <span className="studio-connection-card__text">
          <span className="studio-connection-card__title">{title}</span>
          {sentence && (
            <span className="studio-connection-card__sentence">{sentence}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function UnwrittenCard({
  link,
  onCreate,
}: {
  link: Unwritten;
  onCreate: Props['onCreate'];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="studio-connection-card is-unwritten">
      <span className="studio-connection-card__icon" aria-hidden="true">
        <FileIcon />
      </span>
      <span className="studio-connection-card__text">
        <span className="studio-connection-card__title">{link.title}</span>
        <span className="studio-connection-card__sentence">
          not written yet
        </span>
      </span>
      <button
        type="button"
        className="studio-btn studio-btn--quiet studio-connection-card__create"
        disabled={busy}
        aria-label={`Create the note “${link.title}”`}
        onClick={() => {
          setBusy(true);
          // A created note opens in the editor, which unmounts this card; only
          // a failed attempt is still here to be tried again.
          void onCreate(link).then((created) => !created && setBusy(false));
        }}
      >
        <Icon name="plus" />
        Create this note
      </button>
    </li>
  );
}

/** What links to this note and what it links to, under the page. */
export default function StudioConnections({ state, onOpen, onCreate }: Props) {
  const { connections } = state;
  if (state.status === 'error' && !connections) {
    return (
      <section className="studio-connections" aria-label="Connections">
        <p className="studio-connections__quiet" role="status">
          Couldn’t look up this note’s links just now. They’ll be back after the
          next save.
        </p>
      </section>
    );
  }
  if (!connections) {
    return (
      <section className="studio-connections" aria-label="Connections">
        <p className="studio-connections__quiet" role="status">
          Looking for links…
        </p>
      </section>
    );
  }

  const outbound = orderOutbound(connections.outbound);
  const missing = unwrittenCount(outbound);
  return (
    <section className="studio-connections" aria-label="Connections">
      <Disclosure title={backlinksHeading(connections.backlinks.length)}>
        {connections.backlinks.length ? (
          <ul className="studio-connections__list">
            {connections.backlinks.map((link) => (
              <Card
                key={link.id}
                path={link.id}
                title={link.title}
                icon={link.icon}
                sentence={link.sentence}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ) : (
          <p className="studio-connections__empty">{NO_BACKLINKS}</p>
        )}
      </Disclosure>
      <Disclosure
        title={outboundHeading(outbound.length)}
        badge={missing ? `${missing} not written yet` : undefined}
      >
        {outbound.length ? (
          <ul className="studio-connections__list">
            {outbound.map((link) =>
              link.kind === 'note' ? (
                <Card
                  key={link.note.id}
                  path={link.note.id}
                  title={link.note.title}
                  icon={link.note.icon}
                  onOpen={onOpen}
                />
              ) : (
                <UnwrittenCard
                  key={`${link.folder}/${link.slug}`}
                  link={link}
                  onCreate={onCreate}
                />
              ),
            )}
          </ul>
        ) : (
          <p className="studio-connections__empty">{NO_OUTBOUND}</p>
        )}
      </Disclosure>
    </section>
  );
}
