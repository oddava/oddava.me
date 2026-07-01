import { describe, expect, it } from 'vitest';
import {
  inlineCssVars,
  placeComparisonAlignment,
  resolveCardComparisonProps,
} from '../src/components/mdx/cardComparison';

describe('CardComparison helpers', () => {
  it('maps vertical alignment props to CSS place-items values', () => {
    expect(placeComparisonAlignment(undefined)).toBe('start center');
    expect(placeComparisonAlignment('top')).toBe('start center');
    expect(placeComparisonAlignment('center')).toBe('center center');
    expect(placeComparisonAlignment('bottom')).toBe('end center');
  });

  it('serializes only present CSS custom properties', () => {
    expect(
      inlineCssVars([
        ['--present', '1rem'],
        ['--missing', undefined],
        ['--empty', ''],
        ['--blank', '  '],
        ['--next', 'cover'],
      ]),
    ).toBe('--present: 1rem; --next: cover;');
  });

  it('applies stable defaults for comparison cards', () => {
    const resolved = resolveCardComparisonProps({
      beforeSrc: '/before.webp',
      beforeAlt: 'Before state',
      afterSrc: '/after.webp',
      afterAlt: 'After state',
    });

    expect(resolved).toMatchObject({
      afterAllowUpscale: false,
      afterCaption: 'After',
      afterFit: 'contain',
      beforeAllowUpscale: false,
      beforeCaption: 'Before',
      beforeFit: 'contain',
      className: undefined,
      rootStyle: '',
    });
    expect(resolved.beforeStyle).toBe(
      '--comparison-item-fit: contain; --comparison-item-place: start center;',
    );
    expect(resolved.afterStyle).toBe(
      '--comparison-item-fit: contain; --comparison-item-place: start center;',
    );
  });

  it('lets item-level options override shared defaults', () => {
    const resolved = resolveCardComparisonProps({
      beforeSrc: '/before.webp',
      beforeAlt: 'Before state',
      afterSrc: '/after.webp',
      afterAlt: 'After state',
      fit: 'cover',
      allowUpscale: true,
      align: 'bottom',
      beforeFit: 'contain',
      afterAlign: 'center',
      gap: '2rem',
      height: '20rem',
      class: 'custom-comparison',
    });

    expect(resolved).toMatchObject({
      afterAllowUpscale: true,
      afterFit: 'cover',
      beforeAllowUpscale: true,
      beforeFit: 'contain',
      className: 'custom-comparison',
      rootStyle: '--comparison-gap: 2rem; --comparison-card-height: 20rem;',
    });
    expect(resolved.beforeStyle).toContain('--comparison-item-fit: contain;');
    expect(resolved.beforeStyle).toContain(
      '--comparison-item-place: end center;',
    );
    expect(resolved.afterStyle).toContain('--comparison-item-fit: cover;');
    expect(resolved.afterStyle).toContain(
      '--comparison-item-place: center center;',
    );
  });
});
