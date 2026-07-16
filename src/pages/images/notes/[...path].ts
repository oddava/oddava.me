import type { APIRoute } from 'astro';
import { isStorageUnavailableError } from '../../../lib/server/core';
import { readRedisBinaryFile } from '../../../lib/server/content';

const CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function safeMediaPath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.includes('\\') &&
    path
      .split('/')
      .every((segment) => segment && !['.', '..'].includes(segment))
  );
}

/** Serves Studio uploads that exist only in the runtime content store. */
export const GET: APIRoute = async ({ params }) => {
  const path = params.path ?? '';
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[extension];
  if (!contentType || !safeMediaPath(path)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const bytes = await readRedisBinaryFile(`public/images/notes/${path}`);
    if (!bytes) return new Response('Not found', { status: 404 });
    return new Response(bytes as BodyInit, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(bytes.byteLength),
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      console.error('[content-media] Runtime media read failed.', error);
    }
    return new Response('Media storage is temporarily unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }
};
