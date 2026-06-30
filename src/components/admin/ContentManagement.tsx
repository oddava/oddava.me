interface ContentMetrics {
  posts: number;
  drafts: number;
  projects: number;
  featuredProjects: number;
}

interface ContentManagementProps {
  metrics: ContentMetrics | null;
  keystaticHref: string;
}

export function ContentManagement({
  metrics,
  keystaticHref,
}: ContentManagementProps) {
  return (
    <article id="content" className="admin-card admin-panel">
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">content</p>
          <h2>Content management</h2>
          <p>
            Keystatic stays the editor for MDX content, but it now lives inside
            the main admin workflow.
          </p>
        </div>
      </div>
      {metrics && (
        <div className="content-list">
          <div className="content-card">
            <header>
              <strong>Blog</strong>
              <span className="pill">{metrics.posts} total</span>
            </header>
            <p className="admin-muted">
              {metrics.drafts} drafts currently hidden from the public site.
            </p>
          </div>
          <div className="content-card">
            <header>
              <strong>Projects</strong>
              <span className="pill">{metrics.projects} total</span>
            </header>
            <p className="admin-muted">
              {metrics.featuredProjects} projects are marked featured.
            </p>
          </div>
        </div>
      )}
      <div className="admin-content-links">
        <a className="admin-button primary" href="#content-editor">
          Jump to editor
        </a>
        <a
          className="admin-button ghost"
          href={keystaticHref}
          target="_blank"
          rel="noreferrer"
        >
          Open raw Keystatic
        </a>
        <a className="admin-button ghost" href="/blog">
          View blog
        </a>
        <a className="admin-button ghost" href="/projects">
          View projects
        </a>
      </div>
    </article>
  );
}
