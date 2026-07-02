interface KeystaticEditorProps {
  keystaticHref: string;
}

export function KeystaticEditor({ keystaticHref }: KeystaticEditorProps) {
  return (
    <section id="editor" className="admin-editor-section">
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
