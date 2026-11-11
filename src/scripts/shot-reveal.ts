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
export function revealShots(root: ParentNode = document): void {
  for (const shot of root.querySelectorAll<HTMLElement>(
    '.pf-shot[data-loading]',
  )) {
    const image = shot.querySelector('img');
    if (!image) {
      delete shot.dataset.loading;
      continue;
    }
    if (image.complete) {
      // Already here (or already failed): no fade, and no wait.
      if (image.naturalWidth > 0) delete shot.dataset.loading;
      else shot.dataset.loading = 'failed';
      continue;
    }
    shot.dataset.loading = 'js';
    const settle = () => {
      // Decode off the main thread first, so the fade starts on a finished
      // picture rather than on the frame that decodes it.
      const ready = image.decode ? image.decode().catch(() => {}) : null;
      void Promise.resolve(ready).then(() => {
        delete shot.dataset.loading;
      });
    };
    image.addEventListener('load', settle, { once: true });
    // A broken picture stays hidden: the empty frame reads better than the
    // browser's broken-image glyph.
    image.addEventListener(
      'error',
      () => {
        shot.dataset.loading = 'failed';
      },
      { once: true },
    );
  }
}
