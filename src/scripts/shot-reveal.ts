/**
 * Project pictures arrive whole. A shot rendered with `data-loading` keeps its
 * picture transparent over the frame's quiet surface, then lets it fade in
 * once the image has finished decoding — instead of a slow connection
 * painting it in strips from the top. A picture already in the cache shows
 * at once, with no fade.
 *
 * Without this script the CSS still reveals the picture after a few seconds
 * (see `_projects-page.css`), so no JavaScript never means no picture. The
 * script switches that fallback off as it takes over (`data-loading="js"`).
 */
const FADE_MS = 480;

export function revealShots(root: ParentNode = document): void {
  for (const shot of root.querySelectorAll<HTMLElement>(
    '.pf-shot[data-loading]',
  )) {
    const image = shot.querySelector('img');
    if (!image) {
      delete shot.dataset.loading;
      continue;
    }
    // Cached: shown at once. Only `data-fade` carries a transition, so
    // removing the hidden state here changes nothing that animates.
    if (image.complete) {
      if (image.naturalWidth > 0) delete shot.dataset.loading;
      else shot.dataset.loading = 'failed';
      continue;
    }
    // The CSS fallback already showed it (the script came late): hiding it
    // again to fade it back would flicker.
    if (getComputedStyle(image).opacity !== '0') {
      delete shot.dataset.loading;
      continue;
    }
    shot.dataset.loading = 'js';
    shot.dataset.fade = '';
    const settle = () => {
      // Decode first, so the fade starts on a finished picture rather than
      // on the frame that decodes it.
      const ready = image.decode ? image.decode().catch(() => {}) : null;
      void Promise.resolve(ready).then(() => {
        delete shot.dataset.loading;
        setTimeout(() => delete shot.dataset.fade, FADE_MS + 100);
      });
    };
    image.addEventListener('load', settle, { once: true });
    // A broken picture stays hidden, and the frame says so: that reads better
    // than the browser's broken-image glyph.
    image.addEventListener(
      'error',
      () => {
        shot.dataset.loading = 'failed';
        delete shot.dataset.fade;
      },
      { once: true },
    );
  }
}
