interface ContentMetrics {
  posts: number;
  drafts: number;
  projects: number;
  featuredProjects: number;
  books: number;
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
          <h2>Content</h2>
        </div>
        <a
          className="admin-button primary"
          href={keystaticHref}
          target="_blank"
          rel="noreferrer"
        >
          Open editor
        </a>
      </div>
      {metrics && (
        <div className="content-list">
          <div className="content-card">
            <header>
              <strong>Blog</strong>
              <span className="pill">{metrics.posts}</span>
            </header>
            {metrics.drafts > 0 && (
              <p className="admin-muted">
                {metrics.drafts} draft{metrics.drafts !== 1 ? 's' : ''} hidden
              </p>
            )}
          </div>
          <div className="content-card">
            <header>
              <strong>Projects</strong>
              <span className="pill">{metrics.projects}</span>
            </header>
            {metrics.featuredProjects > 0 && (
              <p className="admin-muted">{metrics.featuredProjects} featured</p>
            )}
          </div>
          <div className="content-card">
            <header>
              <strong>Books</strong>
              <span className="pill">{metrics.books}</span>
            </header>
          </div>
        </div>
      )}
    </article>
  );
}
