// Commands implemented by the rich editor; Markdown remains the persistence format.
export interface EditorCommands {
  bold(): void;
  italic(): void;
  strike(): void;
  inlineCode(): void;
  heading(level: 1 | 2 | 3 | 4 | 5 | 6): void;
  bulletList(): void;
  orderedList(): void;
  taskList(): void;
  quote(): void;
  codeBlock(): void;
  divider(): void;
  table(): void;
  link(): void;
  align(direction: 'left' | 'center' | 'right'): void;
  /** Insert already-built markup (e.g. from the image dialog) as its own block. */
  insertBlock(markup: string): void;
  /** Raw insert at the caret, preserving undo. Used by paste/drop image upload. */
  insertInline(snippet: string): void;
}

// --- Image markup builder (shared by dialog + quick insert) ---------------

export type ImageAlign = 'inline' | 'left' | 'center' | 'right';

export interface ImageMarkupOptions {
  src: string;
  alt: string;
  caption?: string;
  /** Width as a percentage 10–100, or undefined for natural width. */
  widthPercent?: number;
  align: ImageAlign;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the markup for an image. When it needs no styling or caption we emit a
 * plain Markdown image so the source stays clean; anything richer becomes inline
 * HTML (which `marked` renders verbatim in both the preview and the live page).
 * Presentation is expressed through classes because the site's CSP deliberately
 * blocks inline styles.
 */
export function buildImageMarkup(options: ImageMarkupOptions): string {
  const { src, alt, caption, widthPercent, align } = options;
  const trimmedCaption = caption?.trim();
  const hasWidth = typeof widthPercent === 'number' && widthPercent < 100;

  if (align === 'inline' && !hasWidth && !trimmedCaption) {
    return `![${alt}](${src})`;
  }

  const imageClasses = ['note-image'];
  if (hasWidth) imageClasses.push(`note-image--width-${widthPercent}`);
  if (align !== 'inline') imageClasses.push(`note-image--align-${align}`);
  const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" class="${imageClasses.join(' ')}">`;

  if (!trimmedCaption) return img;

  const figureAlign =
    align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
  return [
    `<figure class="note-figure note-figure--align-${figureAlign}">`,
    `  ${img}`,
    `  <figcaption class="note-image-caption">${escapeAttr(
      trimmedCaption,
    )}</figcaption>`,
    `</figure>`,
  ].join('\n');
}
