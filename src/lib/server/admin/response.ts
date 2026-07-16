import { json } from '../core/http';

export function withAdminSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function adminJson(data: unknown, init: ResponseInit = {}): Response {
  return withAdminSecurityHeaders(json(data, init));
}

export function adminRedirect(location: string, status = 302): Response {
  return withAdminSecurityHeaders(
    new Response(null, {
      status,
      headers: {
        Location: location,
      },
    }),
  );
}
