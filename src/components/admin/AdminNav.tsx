import { Icon } from './studioIcons';
import { VisuallyHidden } from '../ui/VisuallyHidden';

export interface AdminSection {
  id: string;
  label: string;
  /** Things waiting on the editor — shown lit, beside the label. */
  count?: number;
  /** Something in the section needs a look; a dot, not a number. */
  attention?: boolean;
}

interface AdminNavProps {
  sections: AdminSection[];
  active: string;
}

/**
 * The site header turned on its side: the wordmark, then the dashboard's
 * sections standing on one vertical hairline, the one being read lighting its
 * segment; after a gap on the same line, the other places an editor goes. On
 * a phone it folds back into the site's horizontal header.
 */
export function AdminNav({ sections, active }: AdminNavProps) {
  return (
    <aside className="adm-rail">
      <a className="adm-rail__brand" href="/admin">
        <span className="adm-rail__wordmark">oddava</span>
        <span className="adm-rail__tag">admin</span>
      </a>

      {/* On a phone, sign out sits opposite the wordmark rather than at the
          far end of the scrolling strip; the rail shows the one in its list. */}
      <form
        className="adm-rail__signout"
        method="post"
        action="/api/admin/logout"
      >
        <button type="submit" className="hair-control adm-act">
          sign out
        </button>
      </form>

      <nav className="adm-nav" aria-label="Admin">
        <ul className="adm-nav__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                className="adm-nav__item"
                href={`#${section.id}`}
                aria-current={active === section.id ? 'location' : undefined}
              >
                <span>{section.label}</span>
                {section.attention ? (
                  <span
                    className="adm-nav__dot"
                    role="img"
                    aria-label="needs attention"
                  />
                ) : (
                  section.count !== undefined && (
                    <span className="adm-nav__count">
                      {section.count}
                      <VisuallyHidden> waiting</VisuallyHidden>
                    </span>
                  )
                )}
              </a>
            </li>
          ))}
        </ul>

        <ul className="adm-nav__list adm-nav__list--places">
          <li>
            <a className="adm-nav__item" href="/admin/files">
              <span>notes</span>
            </a>
          </li>
          <li>
            <a
              className="adm-nav__item"
              href="/"
              target="_blank"
              rel="noopener"
            >
              <span>
                site<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
              </span>
              <span className="adm-nav__glyph">
                <Icon name="external" />
              </span>
            </a>
          </li>
          <li className="adm-nav__signout">
            <form method="post" action="/api/admin/logout">
              <button type="submit" className="adm-nav__item">
                <span>sign out</span>
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
