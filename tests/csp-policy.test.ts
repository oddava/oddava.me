import { describe, expect, it } from 'vitest';
// A plain .mjs module shared with the build verifier; its JSDoc types it.
import { cspPolicyFailures } from '../scripts/lib/csp-policy.mjs';
import astroConfig from '../astro.config.mjs';
import { renderNote } from '../src/lib/garden/render';

const HASH = "'sha256-U2pPbrZUY6+DptlxIuIu0yMlkmaOnL/VySP13k8DjPY='";

// The shape Astro emits for this site's config: every fixed directive, then
// script-src and style-src with their hashes, then the attribute-only style
// loosening.
const EMITTED = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `script-src 'self' ${HASH}`,
  `style-src 'self' ${HASH}`,
  "style-src-attr 'unsafe-inline'",
].join('; ');

describe('content security policy', () => {
  it('accepts the policy the site emits', () => {
    expect(cspPolicyFailures(EMITTED)).toEqual([]);
  });

  it('allows inline styles only as attributes', () => {
    expect(
      cspPolicyFailures(
        EMITTED.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
      ),
    ).toEqual(["style-src allows 'unsafe-inline'"]);
    expect(
      cspPolicyFailures(`${EMITTED}; style-src-elem 'self' 'unsafe-inline'`),
    ).toEqual(["style-src-elem allows 'unsafe-inline'"]);
  });

  it('keeps scripts hash-only', () => {
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:']) {
      expect(
        cspPolicyFailures(
          EMITTED.replace("script-src 'self'", `script-src 'self' ${loose}`),
        ),
      ).toEqual([`script-src allows ${loose}`]);
    }
    expect(
      cspPolicyFailures(`${EMITTED}; script-src-attr 'unsafe-inline'`),
    ).toEqual(["script-src-attr allows 'unsafe-inline'"]);
    expect(cspPolicyFailures(EMITTED.replace(` ${HASH}`, ''))).toContain(
      'script-src has no generated hashes',
    );
  });

  it('configures Astro to loosen style attributes, and nothing else', () => {
    const csp = astroConfig.security?.csp;
    expect(csp && typeof csp === 'object').toBe(true);
    if (!csp || typeof csp !== 'object') return;
    expect(csp.scriptDirective?.resources).toEqual(["'self'"]);
    expect(csp.scriptDirective?.strictDynamic).toBeFalsy();
    expect(csp.styleDirective?.resources).toEqual([
      "'self'",
      { resource: "'unsafe-inline'", kind: 'attribute' },
    ]);
    const directives = (csp.directives ?? []).join('; ');
    expect(directives).not.toMatch(/unsafe/);
    expect(directives).toContain("object-src 'none'");
  });

  it('passes a legacy figure style attribute through to the page', () => {
    // Studio once wrote image sizing as a style attribute; those notes render
    // as raw HTML, and the attribute must reach the page for the size to hold.
    const { html } = renderNote(
      '<figure style="width: 50%; margin-inline: auto"><img src="/images/notes/a.jpg" alt="A field"></figure>',
    );
    expect(html).toContain('<figure style="width: 50%; margin-inline: auto">');
  });
});
