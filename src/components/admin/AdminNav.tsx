import { Icon } from './studioIcons';
import { VisuallyHidden } from '../ui/VisuallyHidden';

export interface AdminSection {
  id: string;
  label: string;
  /** Something in the section needs a look; a dot, not a number. */
  attention?: boolean;
}

interface AdminNavProps {
  sections: AdminSection[];
  active: string;
}

/**
 * The site header, at the desk: the wordmark and the other places an editor
 * goes stand on one horizon that draws itself in from the middle. On a wide
 * screen every section is already in view, so that is all there is; once the
 * desk folds into one column, the sections join the horizon as a strip that
 * lights the one being read.
 */
export function AdminNav({ sections, active }: AdminNavProps) {
  return (
    <header className="adm-top">
      <div className="adm-top__row">
        <a className="adm-top__brand" href="/admin">
          <span className="adm-top__wordmark">oddava</span>
          <span className="adm-top__tag">admin</span>
        </a>

        <nav className="adm-places" aria-label="Admin">
          <a className="hair-control adm-place" href="/admin/files">
            notes
          </a>
          <a
            className="hair-control adm-place"
            href="/"
            target="_blank"
            rel="noopener"
          >
            site<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
            <Icon name="external" />
          </a>
          <form
            className="adm-places__form"
            method="post"
            action="/api/admin/logout"
          >
            <button type="submit" className="hair-control adm-place">
              sign out
            </button>
          </form>
        </nav>
      </div>

      <nav className="adm-strip" aria-label="Sections">
        <ul className="adm-strip__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                className="adm-strip__item"
                href={`#${section.id}`}
                aria-current={active === section.id ? 'location' : undefined}
              >
                {section.label}
                {/* The pending count lives on the guestbook's own tab; the
                    strip only marks what needs a look. */}
                {section.attention && (
                  <span
                    className="adm-strip__dot"
                    role="img"
                    aria-label="needs attention"
                  />
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
