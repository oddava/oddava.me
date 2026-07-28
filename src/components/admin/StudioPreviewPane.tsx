import { useMemo } from 'preact/hooks';
import { renderNote } from '../../lib/garden/render';
import { bodyProvidesTitleHeading } from '../../lib/garden/utils';

interface Props {
  body: string;
  title: string;
  wikiLinkHrefs: ReadonlyMap<string, string>;
}

/**
 * The note as the site will serve it.
 *
 * This is not a second renderer: `renderNote` is the one the published page
 * calls, `.prose` is the stylesheet that page loads, and the chrome around the
 * body — the title the shell supplies when the note doesn't open with its own
 * `# heading`, the reading column's measure, the contents rail — mirrors
 * `GardenDocumentPage.astro`. Anything the editing surface cannot show
 * faithfully (raw HTML blocks, figures, alignment wrappers, anything richer
 * than Markdown) shows here exactly as a reader will get it.
 *
 * The page itself is not embedded in a frame: the site sends
 * `frame-ancestors 'none'`, and loosening that for an admin convenience would
 * trade a real clickjacking defence for a preview that already renders through
 * the same code path.
 *
 * Nothing of the editor's own is drawn here — no path, no chrome. The note's
 * URL is already in the title bar above; repeating it inside the preview would
 * put something on the page that a reader will never see.
 */
export default function StudioPreviewPane({
  body,
  title,
  wikiLinkHrefs,
}: Props) {
  const rendered = useMemo(
    () => (body.trim() ? renderNote(body, { wikiLinkHrefs }) : null),
    [body, wikiLinkHrefs],
  );
  const showShellTitle = !bodyProvidesTitleHeading(body);
  const headings =
    rendered && rendered.headings.length >= 2 ? rendered.headings : [];

  return (
    <div className="studio-preview" aria-label="Preview">
      <div className="studio-preview__layout">
        <article className="studio-preview__page">
          {showShellTitle && <h1 className="studio-preview__title">{title}</h1>}
          {rendered ? (
            <div
              className="prose"
              // The signed-in admin's own Markdown, rendered back to them by
              // the renderer the published page uses.
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          ) : (
            <p className="studio-preview__stub">
              this note is still a stub — nothing here yet.
            </p>
          )}
        </article>
        {headings.length > 0 && (
          <nav className="studio-preview__toc" aria-label="On this page">
            <p className="studio-preview__toc-title">On this page</p>
            <ul>
              {headings.map((heading) => (
                <li key={heading.id} data-depth={heading.depth}>
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
