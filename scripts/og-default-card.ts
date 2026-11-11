/**
 * The site's default share card: the wordmark and one line, centred. Runs in
 * a browser — `scripts/render-og-default.mjs` bundles it, paints it onto a
 * canvas and saves public/og-default.png.
 */

const WIDTH = 1200;
const HEIGHT = 630;
// The note cards' palette (src/components/admin/socialCard.ts).
const BACKGROUND = '#0c0e11';
const FOREGROUND = '#e4e8ee';
const MUTED = '#9aa3ad';
const WORDMARK = "700 120px 'M PLUS Rounded 1c'";
const LINE = "400 34px 'M PLUS Rounded 1c'";

export async function paintCard(canvas: HTMLCanvasElement): Promise<void> {
  await document.fonts.load(WORDMARK);
  await document.fonts.load(LINE);
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = WORDMARK;
  ctx.fillStyle = FOREGROUND;
  ctx.fillText('oddava', WIDTH / 2, 330);

  ctx.font = LINE;
  ctx.fillStyle = MUTED;
  ctx.fillText('software, notes, and small tools', WIDTH / 2, 410);
}
