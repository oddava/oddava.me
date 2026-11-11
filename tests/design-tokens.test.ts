import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INKS,
  INK_NAMES,
  THEMES,
  contrastRatio,
  deriveCustomInk,
  mixSrgb,
  papersOf,
  worstContrast,
  type Paper,
  type ThemeName,
} from '../src/lib/design/palette';
import { SITE_SPRING, springEasing } from '../src/lib/design/spring';
import { TOKEN_ROLES } from '../src/lib/garden/highlight';

const tokensCss = readFileSync(
  new URL('../src/styles/_tokens.css', import.meta.url),
  'utf8',
);

function cssValue(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i')
    .exec(tokensCss)?.[1]
    ?.toLowerCase();
}

const ROLE_TO_CSS: Record<keyof Paper, string> = {
  paper: 'paper',
  paperRaised: 'paper-raised',
  paperSunken: 'paper-sunken',
  ink: 'ink',
  ink2: 'ink-2',
  ink3: 'ink-3',
  rule: 'rule',
  ruleStrong: 'rule-strong',
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
};

const TEXT_ROLES = ['ink', 'ink2', 'ink3', 'ok', 'warn', 'danger'] as const;
const themes = Object.entries(THEMES) as [ThemeName, Paper][];
const side = (theme: ThemeName) => (theme === 'vellum' ? 'light' : 'dark');

describe('design tokens', () => {
  it('keeps _tokens.css and palette.ts in step', () => {
    for (const [name, theme] of themes) {
      for (const [role, cssName] of Object.entries(ROLE_TO_CSS)) {
        expect(cssValue(`${name}-${cssName}`), `${name} ${role}`).toBe(
          theme[role as keyof Paper],
        );
      }
    }
    for (const ink of INK_NAMES) {
      expect(cssValue(`ink-${ink}-light`)).toBe(INKS[ink].light);
      expect(cssValue(`ink-${ink}-dark`)).toBe(INKS[ink].dark);
    }
  });

  it('never paints a pure black or white canvas', () => {
    for (const [, theme] of themes) {
      expect(['#000000', '#ffffff']).not.toContain(theme.paper);
    }
  });

  for (const [name, theme] of themes) {
    describe(name, () => {
      it('sets every text role at 4.5:1 or better on every paper', () => {
        for (const role of TEXT_ROLES) {
          for (const paper of papersOf(theme)) {
            expect(
              contrastRatio(theme[role], paper),
              `${role} ${theme[role]} on ${paper}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it('draws control borders at 3:1 or better', () => {
        expect(worstContrast(theme.ruleStrong, theme)).toBeGreaterThanOrEqual(
          3,
        );
      });

      for (const ink of INK_NAMES) {
        it(`reads ${ink} at 4.5:1 or better, with ink legible on its wash`, () => {
          const color = INKS[ink][side(name)];
          expect(worstContrast(color, theme)).toBeGreaterThanOrEqual(4.5);
          // The highlight (<mark>) and the selection are the ink washed
          // over the paper; body text must still read on both.
          const wash = mixSrgb(color, theme.paper, 0.12);
          const selection = mixSrgb(color, theme.paper, 0.22);
          expect(contrastRatio(theme.ink, wash)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(theme.ink, selection)).toBeGreaterThanOrEqual(
            4.5,
          );
          expect(contrastRatio(color, wash)).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  it('carries the generated spring as --ease-spring', () => {
    const generated = springEasing(SITE_SPRING);
    const declared = /--ease-spring:\s*(linear\([^)]*\))/s
      .exec(tokensCss)?.[1]
      ?.replace(/\s+/g, ' ')
      .replace('( ', '(')
      .replace(' )', ')');
    expect(declared).toBe(generated);
  });

  it('moves a custom ink just far enough to read on both papers', () => {
    for (const hex of ['#ffdd00', '#00ff00', '#3366ff', '#ff0000', '#999999']) {
      const pair = deriveCustomInk(hex);
      expect(pair, hex).not.toBeNull();
      expect(worstContrast(pair!.light, THEMES.vellum)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        worstContrast(pair!.dark, THEMES.lamplight),
      ).toBeGreaterThanOrEqual(4.5);
    }
    // A colour that already reads is left exactly as chosen.
    expect(deriveCustomInk('#b9381f')?.light).toBe('#b9381f');
    expect(deriveCustomInk('not a colour')).toBeNull();
  });
});

describe('rubricated code', () => {
  const codeCss = readFileSync(
    new URL('../src/styles/components/_code.css', import.meta.url),
    'utf8',
  );

  it('styles every token role the highlighter emits, and no other', () => {
    const styled = new Set(
      [...codeCss.matchAll(/\.tok-([a-z]+)/g)].map((match) => match[1]),
    );
    expect([...styled].sort()).toEqual([...TOKEN_ROLES].sort());
  });

  it('colours tokens only from the design tokens', () => {
    expect(codeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
