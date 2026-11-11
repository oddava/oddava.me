/**
 * The appearance panel's controller: six preferences, saved as JSON in
 * `localStorage.appearance` and applied as `data-*` attributes on <html>.
 * The pre-paint script (lib/portfolio/appearance.ts) applies a saved choice
 * before first paint; this keeps the panel and storage in step after that.
 *
 * The panel's position is pure CSS; nothing here writes inline styles.
 */
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_STORAGE_KEY,
  sanitizeAppearance,
  type Appearance,
} from '../lib/portfolio/appearance';

const NOT_KEPT =
  "this browser isn't keeping settings, so they'll reset on reload.";

export function mountAppearance(): void {
  // Portfolio pages keep their choices on <html>. A page that only borrows
  // the header (the 404) marks a wrapper instead, so its own theme is left
  // alone; there is no pre-paint there, so the saved choices load here.
  const scoped = document.querySelector<HTMLElement>('[data-appearance-root]');
  const root = scoped ?? document.documentElement;
  const toggle = document.getElementById('appearance-toggle');
  const panel = document.getElementById('appearance-panel');
  const form = document.getElementById(
    'appearance-form',
  ) as HTMLFormElement | null;
  const reset = document.getElementById('appearance-reset');
  const status = document.getElementById('appearance-status');
  const tool = toggle?.closest<HTMLElement>('[data-appearance-tool]');
  if (!toggle || !panel || !form || !reset || !status || !tool) return;
  if (toggle.dataset.mounted) return;
  toggle.dataset.mounted = 'true';

  const current = (): Appearance => ({
    ...APPEARANCE_DEFAULTS,
    ...sanitizeAppearance(
      Object.fromEntries(
        APPEARANCE_KEYS.map((key) => [key, root.getAttribute(`data-${key}`)]),
      ),
    ),
  });

  const apply = (prefs: Appearance) => {
    for (const key of APPEARANCE_KEYS) {
      root.setAttribute(`data-${key}`, prefs[key]);
    }
  };

  const syncForm = (prefs: Appearance) => {
    for (const key of APPEARANCE_KEYS) {
      const input = form.querySelector<HTMLInputElement>(
        `input[name="${key}"][value="${prefs[key]}"]`,
      );
      if (input) input.checked = true;
    }
  };

  const save = (prefs: Appearance) => {
    try {
      window.localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify(prefs),
      );
      status.textContent = '';
    } catch {
      status.textContent = NOT_KEPT;
    }
  };

  // Storage can be blocked (private modes, site-data settings). The controls
  // still work for this visit; say so instead of failing silently.
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    status.textContent = NOT_KEPT;
  }

  if (scoped && stored) {
    try {
      apply({
        ...APPEARANCE_DEFAULTS,
        ...sanitizeAppearance(JSON.parse(stored)),
      });
    } catch {
      // A malformed value leaves the defaults, as the pre-paint does.
    }
  }

  syncForm(current());

  form.addEventListener('change', () => {
    const data = new FormData(form);
    const chosen = sanitizeAppearance(
      Object.fromEntries(APPEARANCE_KEYS.map((key) => [key, data.get(key)])),
    );
    const prefs = { ...current(), ...chosen };
    apply(prefs);
    save(prefs);
  });

  reset.addEventListener('click', () => {
    apply(APPEARANCE_DEFAULTS);
    syncForm(APPEARANCE_DEFAULTS);
    try {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
      status.textContent = 'back to the defaults.';
    } catch {
      status.textContent = 'back to the defaults for this visit.';
    }
  });

  // A short scale-and-fade from the icon, only when motion is on.
  const motionOn = () =>
    root.getAttribute('data-motion') !== 'reduced' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let running: Animation | null = null;
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

  const open = () => {
    running?.cancel();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (motionOn() && panel.animate) {
      running = panel.animate(
        [
          { opacity: 0, transform: 'scale(0.96) translateY(-4px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    form
      .querySelector<HTMLInputElement>('input:checked')
      ?.focus({ preventScroll: true });
  };

  const close = (restoreFocus: boolean) => {
    if (panel.hidden) return;
    running?.cancel();
    toggle.setAttribute('aria-expanded', 'false');
    const finish = () => {
      panel.hidden = true;
      running = null;
    };
    if (motionOn() && panel.animate) {
      running = panel.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.98)' },
        ],
        { duration: 110, easing: 'ease-in' },
      );
      running.onfinish = finish;
    } else {
      finish();
    }
    if (restoreFocus) toggle.focus({ preventScroll: true });
  };

  toggle.addEventListener('click', () => {
    if (isOpen()) close(false);
    else open();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isOpen()) {
      event.preventDefault();
      close(true);
      tool.classList.add('tip-off');
    } else if (tool.matches(':hover') || document.activeElement === toggle) {
      // WCAG 1.4.13: the tooltip can be dismissed without moving away.
      tool.classList.add('tip-off');
    }
  });

  // The tooltip comes back once the pointer or focus leaves and returns.
  tool.addEventListener('pointerleave', () => tool.classList.remove('tip-off'));
  toggle.addEventListener('blur', () => tool.classList.remove('tip-off'));

  document.addEventListener('pointerdown', (event) => {
    if (!isOpen()) return;
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || toggle.contains(target))) return;
    close(panel.contains(document.activeElement));
  });

  // Tabbing past the panel closes it without pulling focus back.
  panel.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.contains(next) && next !== toggle) close(false);
  });
}
