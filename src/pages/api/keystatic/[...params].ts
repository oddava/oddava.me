import { makeHandler } from '@keystatic/astro/api';
import type { APIContext } from 'astro';
import config from '../../../../keystatic.config';
import { normalizeKeystaticRequestOrigin } from '../../../lib/server/keystatic/origin';

const handler = makeHandler({ config });

function withRequest(context: APIContext, request: Request): APIContext {
  return Object.assign(Object.create(context), { request });
}

async function all(context: APIContext): Promise<Response> {
  const rewrittenRequest = normalizeKeystaticRequestOrigin(context.request);

  if (rewrittenRequest === context.request) {
    return handler(context);
  }

  return handler(withRequest(context, rewrittenRequest));
}

export { all, all as ALL };
export const prerender = false;
