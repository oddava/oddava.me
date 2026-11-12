/**
 * The light on a hovered project picture follows the pointer, like the
 * visionOS highlight. The script only moves the light: `.pf-sheen` and
 * `_projects-page.css` decide whether it shows at all. It sets the light's
 * centre through the CSSOM (`style.setProperty`), which the CSP allows
 * where an inline style attribute would not.
 *
 * Only a fine pointer that can hover gets it, and only without reduced
 * motion; everyone else keeps the light's fixed resting spot, which CSS
 * already hides on those devices.
 */
export function trackSheen(root: ParentNode = document): void {
  const allowed = window.matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  if (!allowed.matches) return;

  for (const card of root.querySelectorAll<HTMLElement>('.pf-card--linked')) {
    const shot = card.querySelector<HTMLElement>('.pf-shot');
    const sheen = shot?.querySelector<HTMLElement>('.pf-sheen');
    if (!shot || !sheen) continue;

    let frame = 0;
    let x = 0;
    let y = 0;
    card.addEventListener('pointermove', (event) => {
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Measured per frame: the frame is mid-scale while the lift settles.
        const box = shot.getBoundingClientRect();
        sheen.style.setProperty('--sheen-x', `${x - box.left}px`);
        sheen.style.setProperty('--sheen-y', `${y - box.top}px`);
      });
    });
  }
}
