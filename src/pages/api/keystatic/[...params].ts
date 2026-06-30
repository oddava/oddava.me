import { makeHandler } from '@keystatic/astro/api';
import type { APIContext } from 'astro';
import config from '../../../../keystatic.config';
import { normalizeKeystaticRequestOrigin } from '../../../lib/server/keystatic/origin';

const handler = makeHandler({ config });

async function all(context: APIContext): Promise<Response> {
  const rewrittenRequest = normalizeKeystaticRequestOrigin(context.request);

  if (rewrittenRequest === context.request) {
    return handler(context);
  }

  return handler({ ...context, request: rewrittenRequest });
}

export { all, all as ALL };
export const prerender = false;
