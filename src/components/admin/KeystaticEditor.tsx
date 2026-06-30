interface KeystaticEditorProps {
  keystaticHref: string;
}

export function KeystaticEditor({ keystaticHref }: KeystaticEditorProps) {
  return (
    <section
      id="content-editor"
      className="admin-card admin-panel admin-editor-panel"
    >
      <div className="admin-section-head">
        <div>
          <p className="admin-kicker">editor</p>
          <h2>Embedded Keystatic</h2>
          <p>
            Edit blog posts and projects without leaving the unified admin
            panel.
          </p>
        </div>
      </div>
      <div className="admin-iframe-shell">
        <iframe
          title="Keystatic content editor"
          src={keystaticHref}
          className="admin-iframe"
        />
      </div>
    </section>
  );
}
