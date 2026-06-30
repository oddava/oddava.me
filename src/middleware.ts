import { defineMiddleware } from 'astro:middleware';
import { applySecurityHeaders } from './lib/server/security-headers';

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const response = await next();
  return applySecurityHeaders(response, request.url);
});
