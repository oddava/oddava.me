export type ComparisonFit =
  'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
export type ComparisonAlign = 'top' | 'center' | 'bottom';

export interface CardComparisonProps {
  beforeSrc: string;
  beforeAlt: string;
  afterSrc: string;
  afterAlt: string;
  beforeCaption?: string;
  afterCaption?: string;
  height?: string;
  aspect?: string;
  gap?: string;
  fit?: ComparisonFit;
  allowUpscale?: boolean;
  align?: ComparisonAlign;
  beforeHeight?: string;
  afterHeight?: string;
  beforeAspect?: string;
  afterAspect?: string;
  beforeFit?: ComparisonFit;
  afterFit?: ComparisonFit;
  beforeAllowUpscale?: boolean;
  afterAllowUpscale?: boolean;
  beforeAlign?: ComparisonAlign;
  afterAlign?: ComparisonAlign;
  beforePosition?: string;
  afterPosition?: string;
  class?: string;
}

export interface ResolvedCardComparison {
  afterAllowUpscale: boolean;
  afterCaption: string;
  afterFit: ComparisonFit;
  afterStyle: string;
  beforeAllowUpscale: boolean;
  beforeCaption: string;
  beforeFit: ComparisonFit;
  beforeStyle: string;
  className: string | undefined;
  rootStyle: string;
}

export function placeComparisonAlignment(
  alignValue: ComparisonAlign | undefined,
): string {
  if (alignValue === 'center') return 'center center';
  if (alignValue === 'bottom') return 'end center';
  return 'start center';
}

export function inlineCssVars(
  entries: Array<[string, string | undefined]>,
): string {
  return entries
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}

export function resolveCardComparisonProps(
  props: CardComparisonProps,
): ResolvedCardComparison {
  const fit = props.fit ?? 'contain';
  const allowUpscale = props.allowUpscale ?? false;
  const align = props.align ?? 'top';

  const beforeFit = props.beforeFit ?? fit;
  const afterFit = props.afterFit ?? fit;
  const beforeAllowUpscale = props.beforeAllowUpscale ?? allowUpscale;
  const afterAllowUpscale = props.afterAllowUpscale ?? allowUpscale;
  const beforeAlign = props.beforeAlign ?? align;
  const afterAlign = props.afterAlign ?? align;

  return {
    afterAllowUpscale,
    afterCaption: props.afterCaption ?? 'After',
    afterFit,
    afterStyle: inlineCssVars([
      ['--comparison-item-height', props.afterHeight],
      ['--comparison-item-aspect', props.afterAspect],
      ['--comparison-item-fit', afterFit],
      ['--comparison-item-place', placeComparisonAlignment(afterAlign)],
      ['--comparison-item-position', props.afterPosition],
    ]),
    beforeAllowUpscale,
    beforeCaption: props.beforeCaption ?? 'Before',
    beforeFit,
    beforeStyle: inlineCssVars([
      ['--comparison-item-height', props.beforeHeight],
      ['--comparison-item-aspect', props.beforeAspect],
      ['--comparison-item-fit', beforeFit],
      ['--comparison-item-place', placeComparisonAlignment(beforeAlign)],
      ['--comparison-item-position', props.beforePosition],
    ]),
    className: props.class,
    rootStyle: inlineCssVars([
      ['--comparison-gap', props.gap],
      ['--comparison-card-height', props.height],
      ['--comparison-card-aspect', props.aspect],
    ]),
  };
}
