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
import {
  applySecurityHeaders,
  isNotesHostRequest,
  runAsNotesHostRequest,
} from './lib/server/core';
import { mapNotesHostPath } from './lib/notes-host';

type HandleArgs = Parameters<typeof handle>;

/**
 * TEMPORARY, for the step 1.4 soak; step 1.5 removes it. Until the apex's
 * `/notes` pages 301 here, every note has two canonical URLs, so the notes
 * host asks not to be indexed. robots.txt stays crawlable: a crawler has to
 * fetch a page to see this header. Only responses this Worker produces get it;
 * assets Cloudflare serves without running the Worker do not (docs/notes-host.md).
 */
function withSoakNoindex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetch(
  request: Request,
  env: HandleArgs[1],
  context: HandleArgs[2],
): Promise<Response> {
  const url = new URL(request.url);
  // Prerendered pages now reach the Worker, and the adapter returns them from
  // the asset store without running middleware. Set-if-missing keeps their
  // headers the same as `public/_headers` gives them when served directly.
  const respond = async (forwarded: Request) =>
    applySecurityHeaders(
      (await handle(forwarded, env, context)) as unknown as Response,
      url,
    );

  if (!isNotesHostRequest(url)) return respond(request);

  const decision = mapNotesHostPath(url.pathname);
  if (decision.kind === 'redirect') {
    return withSoakNoindex(
      applySecurityHeaders(
        new Response(null, {
          status: 301,
          headers: { Location: `${decision.location}${url.search}` },
        }),
        url,
      ),
    );
  }

  let forwarded = request;
  if (decision.kind === 'serve') {
    const target = new URL(url);
    target.pathname = decision.pathname;
    forwarded = new Request(target, request);
  }
  // Everything rendered for this request links root-relative (`/x`), so no
  // link on the notes host needs the `/notes` redirect.
  return withSoakNoindex(await runAsNotesHostRequest(() => respond(forwarded)));
}

export default { fetch };
