import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_STEP,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  displayAttributes,
  displayOf,
  snapFocus,
  snapZoom,
  storedDisplay,
} from '../src/lib/project-image';
import { parseProjects } from '../src/lib/server/projects';

const project = (image: Record<string, unknown>) => ({
  id: 'p',
  name: 'p',
  description: 'p.',
  year: 2026,
  stack: [],
  image: { src: '/images/notes/projects/shot.webp', alt: 'a shot', ...image },
});

describe('project image display', () => {
  it('snaps focus and zoom to their steps and bounds', () => {
    expect(snapFocus(37)).toBe(35);
    expect(snapFocus(38)).toBe(40);
    expect(snapFocus(-10)).toBe(0);
    expect(snapFocus(140)).toBe(100);
    expect(snapFocus(Number.NaN)).toBe(50);
    expect(snapZoom(1.26)).toBe(1.3);
    expect(snapZoom(0.4)).toBe(1);
    expect(snapZoom(9)).toBe(2);
  });

  it('stores only what differs from the default', () => {
    expect(storedDisplay({ fit: 'cover', x: 50, y: 50, zoom: 1 })).toEqual({});
    expect(storedDisplay({ fit: 'cover', x: 20, y: 50, zoom: 1.5 })).toEqual({
      x: 20,
      zoom: 1.5,
    });
  });

  it('drops focus and zoom from a whole image', () => {
    expect(storedDisplay({ fit: 'contain', x: 20, y: 80, zoom: 2 })).toEqual({
      fit: 'contain',
    });
  });

  it('reads an image saved before these fields as the default', () => {
    expect(displayOf({ src: '/x.png', alt: 'x' })).toEqual({
      fit: 'cover',
      x: 50,
      y: 50,
      zoom: 1,
    });
  });

  it('turns a display into the attributes the card stylesheet reads', () => {
    expect(
      displayAttributes({ src: '/x.png', alt: 'x', x: 15, y: 50, zoom: 2 }),
    ).toEqual({ 'data-x': '15', 'data-zoom': '2.0' });
    expect(displayAttributes({ src: '/x.png', alt: 'x' })).toEqual({});
  });

  // The card cannot use inline styles (hashed CSP), so every step needs its
  // own rule. A step added to the module without a rule would do nothing.
  it('has a stylesheet rule for every step', () => {
    const css = readFileSync('src/styles/components/_projects.css', 'utf8');
    for (let value = 0; value <= 100; value += FOCUS_STEP) {
      if (value === 50) continue;
      expect(css).toContain(`.pcard__img[data-x='${value}']`);
      expect(css).toContain(`.pcard__img[data-y='${value}']`);
    }
    for (
      let zoom = ZOOM_MIN + ZOOM_STEP;
      zoom <= ZOOM_MAX + 1e-9;
      zoom += ZOOM_STEP
    ) {
      expect(css).toContain(`.pcard__img[data-zoom='${zoom.toFixed(1)}']`);
    }
  });
});

describe('parseProjects image display', () => {
  it('snaps sent values and keeps only non-defaults', () => {
    const result = parseProjects([project({ x: 37, y: 50, zoom: 1.26 })]);
    expect(result.ok && result.projects[0].image).toEqual({
      src: '/images/notes/projects/shot.webp',
      alt: 'a shot',
      x: 35,
      zoom: 1.3,
    });
  });

  it('accepts an explicit cover and stores it as the default', () => {
    const result = parseProjects([project({ fit: 'cover' })]);
    expect(result.ok && result.projects[0].image).toEqual({
      src: '/images/notes/projects/shot.webp',
      alt: 'a shot',
    });
  });

  it('keeps contain without focus or zoom', () => {
    const result = parseProjects([project({ fit: 'contain', x: 10, zoom: 2 })]);
    expect(result.ok && result.projects[0].image).toEqual({
      src: '/images/notes/projects/shot.webp',
      alt: 'a shot',
      fit: 'contain',
    });
  });

  it('refuses a display value of the wrong kind', () => {
    expect(parseProjects([project({ fit: 'stretch' })]).ok).toBe(false);
    expect(parseProjects([project({ x: '20' })]).ok).toBe(false);
    expect(parseProjects([project({ zoom: null })]).ok).toBe(true);
  });
});
