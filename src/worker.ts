/**
 * The Worker entry: Astro's Cloudflare handler, with the notes hostname mapped
 * onto the `/notes…` routes first.
 *
 * This cannot live in Astro middleware. The adapter answers any request that
 * matches a prerendered page or static file straight from the asset store,
 * before middleware runs, so on the notes host `/` would be the apex home and
 * a note called `about` would be the apex about page. `assets.run_worker_first`
 * in wrangler.jsonc sends those requests here; this entry rewrites them before
 * the adapter looks for an asset. tests/notes-host-assets.test.ts guards both
 * halves.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { applySecurityHeaders, isNotesHostRequest } from './lib/server/core';
import { mapNotesHostPath } from './lib/notes-host';

type HandleArgs = Parameters<typeof handle>;

async function fetch(
  request: Request,
  env: HandleArgs[1],
  context: HandleArgs[2],
): Promise<Response> {
  const url = new URL(request.url);
  let forwarded = request;

  if (isNotesHostRequest(url)) {
    const decision = mapNotesHostPath(url.pathname);
    if (decision.kind === 'redirect') {
      return applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: { Location: `${decision.location}${url.search}` },
        }),
        url,
      );
    }
    if (decision.kind === 'serve') {
      const target = new URL(url);
      target.pathname = decision.pathname;
      forwarded = new Request(target, request);
    }
  }

  const response = await handle(forwarded, env, context);
  // Prerendered pages now reach the Worker, and the adapter returns them from
  // the asset store without running middleware. Set-if-missing keeps their
  // headers the same as `public/_headers` gives them when served directly.
  return applySecurityHeaders(response as unknown as Response, url);
}

export default { fetch };
