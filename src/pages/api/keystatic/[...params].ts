import { makeHandler } from '@keystatic/astro/api';
import type { APIContext } from 'astro';
import config from '../../../../keystatic.config';
import { getServerEnv } from '../../../lib/server/env';
import { normalizeKeystaticRequestOrigin } from '../../../lib/server/keystatic/origin';

function createHandler() {
  return makeHandler({
    config,
    clientId: getServerEnv('KEYSTATIC_GITHUB_CLIENT_ID'),
    clientSecret: getServerEnv('KEYSTATIC_GITHUB_CLIENT_SECRET'),
    secret: getServerEnv('KEYSTATIC_SECRET'),
  });
}

function withRequest(context: APIContext, request: Request): APIContext {
  return Object.assign(Object.create(context), { request });
}

async function all(context: APIContext): Promise<Response> {
  const handler = createHandler();
  const rewrittenRequest = normalizeKeystaticRequestOrigin(context.request);

  if (rewrittenRequest === context.request) {
    return handler(context);
  }

  return handler(withRequest(context, rewrittenRequest));
}

export { all, all as ALL };
export const prerender = false;
