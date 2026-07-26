import {
  SOCIAL_CARD_HEIGHT,
  SOCIAL_CARD_WIDTH,
} from '../../lib/garden/og-card';
import type { SocialCardStatus } from '../../lib/contracts';

// The palette public/og-default.svg already uses, so a generated card and the
// default one read as the same artwork with different words in it.
const BACKGROUND = '#0c0e11';
const ACCENT = '#5f92bd';
const ACCENT_SOFT = '#7aa6cb';
const FOREGROUND = '#e4e8ee';
const MUTED = '#aab2bf';
const RULE = 'rgba(228, 232, 238, 0.14)';

const BODY_FONT = "'M PLUS Rounded 1c', system-ui, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'Courier New', monospace";

const MARGIN = 96;
const CONTENT_WIDTH = SOCIAL_CARD_WIDTH - MARGIN * 2;
const TITLE_TOP = 264;
const RULE_Y = 528;
const FOOTER_BASELINE = 574;

/**
 * Largest type that still fits, tried in order. Fewer lines are allowed at the
 * larger sizes so a long title steps down rather than running into the footer
 * rule; the last entry accepts a truncated third line.
 */
const TITLE_STEPS = [
  { size: 76, maxLines: 2 },
  { size: 66, maxLines: 3 },
  { size: 56, maxLines: 3 },
] as const;

function wrapTitle(
  context: CanvasRenderingContext2D,
  title: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of title.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);

  // A single unbroken word — a URL, a long identifier — cannot be wrapped on
  // spaces, so break it on characters rather than letting it bleed off the card.
  return lines.flatMap((entry) => {
    if (context.measureText(entry).width <= maxWidth) return [entry];
    const broken: string[] = [];
    let current = '';
    for (const character of entry) {
      if (
        current &&
        context.measureText(current + character).width > maxWidth
      ) {
        broken.push(current);
        current = '';
      }
      current += character;
    }
    if (current) broken.push(current);
    return broken;
  });
}

function truncate(
  context: CanvasRenderingContext2D,
  line: string,
  maxWidth: number,
): string {
  let text = line;
  while (text && context.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text.trimEnd()}…`;
}

function layoutTitle(
  context: CanvasRenderingContext2D,
  title: string,
): { size: number; lines: string[] } {
  for (const [index, step] of TITLE_STEPS.entries()) {
    context.font = `700 ${step.size}px ${BODY_FONT}`;
    const lines = wrapTitle(context, title, CONTENT_WIDTH);
    if (lines.length <= step.maxLines) return { size: step.size, lines };
    if (index < TITLE_STEPS.length - 1) continue;

    const kept = lines.slice(0, step.maxLines);
    kept[kept.length - 1] = truncate(
      context,
      kept[kept.length - 1]!,
      CONTENT_WIDTH,
    );
    return { size: step.size, lines: kept };
  }
  return { size: TITLE_STEPS[0].size, lines: [title] };
}

/** Draws the card. Exported so a test can drive it against a stub context. */
export function drawSocialCard(
  context: CanvasRenderingContext2D,
  card: Pick<SocialCardStatus, 'title' | 'folder' | 'date' | 'path'>,
): void {
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT);
  context.fillStyle = ACCENT;
  context.fillRect(0, 0, SOCIAL_CARD_WIDTH, 6);

  // The ring mark, at the scale the default card draws it.
  context.beginPath();
  context.arc(MARGIN + 26, 118, 26, 0, Math.PI * 2);
  context.strokeStyle = ACCENT_SOFT;
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(MARGIN + 26, 118, 10, 0, Math.PI * 2);
  context.fillStyle = ACCENT;
  context.fill();

  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.font = `500 26px ${MONO_FONT}`;
  context.fillStyle = MUTED;
  context.fillText('oddava.me', MARGIN + 70, 128);

  if (card.folder) {
    context.font = `500 28px ${MONO_FONT}`;
    context.fillStyle = ACCENT;
    context.fillText(card.folder, MARGIN, 222, CONTENT_WIDTH);
  }

  const { size, lines } = layoutTitle(context, card.title);
  context.font = `700 ${size}px ${BODY_FONT}`;
  context.fillStyle = FOREGROUND;
  for (const [index, line] of lines.entries()) {
    context.fillText(
      line,
      MARGIN,
      TITLE_TOP + size * 0.78 + index * size * 1.2,
    );
  }

  context.fillStyle = RULE;
  context.fillRect(MARGIN, RULE_Y, CONTENT_WIDTH, 1);

  context.font = `400 26px ${MONO_FONT}`;
  context.fillStyle = MUTED;
  context.fillText(card.date, MARGIN, FOOTER_BASELINE);
  context.textAlign = 'right';
  context.fillStyle = ACCENT;
  context.fillText(
    card.path === 'index' ? '/notes' : `/notes/${card.path}`,
    SOCIAL_CARD_WIDTH - MARGIN,
    FOOTER_BASELINE,
    CONTENT_WIDTH / 2,
  );
}

/**
 * `document.fonts.load` resolves once the face is usable by canvas. Without it
 * the first card of a session would be measured and drawn in the fallback
 * system font, since `@font-face` files load lazily.
 */
async function loadCardFonts(): Promise<void> {
  await Promise.all(
    TITLE_STEPS.map((step) =>
      document.fonts.load(`700 ${step.size}px 'M PLUS Rounded 1c'`),
    ).concat([
      document.fonts.load("400 26px 'JetBrains Mono'"),
      document.fonts.load("500 28px 'JetBrains Mono'"),
    ]),
  );
}

export async function renderSocialCard(
  card: SocialCardStatus,
): Promise<Blob | null> {
  await loadCardFonts().catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = SOCIAL_CARD_WIDTH;
  canvas.height = SOCIAL_CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  drawSocialCard(context, card);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
